import { getAutomationModule } from "@/lib/automation-modules";
import { recordWorkflowExecution } from "./execution-history";
import { isCircuitOpen, CONSECUTIVE_FAILURE_THRESHOLD } from "./circuit-breaker";
import { persistWorkflowWait } from "./resume";
import { logger } from "@/lib/logger";
import type { WorkflowContext } from "@/lib/automation-modules/types";
import type { WorkflowWithSteps, WorkflowStep } from "@/types/workflow";
import type { Order } from "@/types/order";

export type RunWorkflowOptions = {
  // Step orders to skip entirely — no module call, no new
  // workflow_executions row. Used by retryFailedWorkflowExecutions
  // (app/admin/actions.ts) so a retry doesn't re-send a step that already
  // succeeded the first time (a WhatsApp message, a webhook) just because
  // some other step in the same run failed. The engine has no per-step
  // resume state of its own — the caller derives this set from today's
  // existing workflow_executions rows and passes it in.
  //
  // Trade-off, acceptable under YAGNI: a skipped step's own ModuleResult.data
  // is not re-added to `context` on a retry (it was never persisted — see
  // recordWorkflowExecution), so a later step reading a skipped step's
  // context output would see it missing. No shipped module currently reads
  // another step's context output, so this has no observable effect today;
  // if one ever does, that module's shouldRun()/run() should tolerate a
  // missing context entry regardless of retries.
  skipStepOrders?: Set<number>;
};

// Defense-in-depth, shared by runWorkflow() and resumeWorkflow(): workflow_
// executions' RLS policy scopes visibility via workflow_id -> workflows.
// shop_id, never via order_id -> orders.shop_id, so nothing at the database
// layer stops a mismatched (workflow, order) pair from being written. Every
// current caller (dispatch.handleEvent, retryFailedWorkflowExecutions, "Test
// Workflow Now", the automation-retry cron's resume path) already only ever
// pairs a workflow with an order from the same shop, so this never fires
// today — it exists to turn a future caller's mismatch into a loud, logged
// no-op instead of a silent cross-tenant data-integrity gap.
function assertSameShop(workflow: WorkflowWithSteps, order: Order): boolean {
  if (order.shop_id !== null && order.shop_id !== workflow.shop_id) {
    console.error(
      `runWorkflow: refusing to run workflow ${workflow.id} (shop ${workflow.shop_id}) against order ${order.id} (shop ${order.shop_id}) — shop mismatch.`
    );
    return false;
  }
  return true;
}

// A module's own reported durationMs (Delay's only data field) becomes the
// wait's resume_at — falls back to "resume on the next cron tick" when a
// future "waiting" module doesn't provide one, rather than waiting forever.
function computeResumeAt(data: Record<string, unknown> | undefined): Date {
  const durationMs = typeof data?.durationMs === "number" ? data.durationMs : 0;
  return new Date(Date.now() + Math.max(0, durationMs));
}

// The shared per-step loop — sequential execution, circuit breaker, outcome
// handling, all in one place so runWorkflow() (a fresh run, every step,
// empty context) and resumeWorkflow() (continuing after a persisted pause,
// a step suffix, restored context) can't drift into two different
// implementations of the same execution semantics. `steps` is whatever
// subset the caller wants executed, in order; `workflow.steps` (the full,
// unfiltered list) is still used to look up "the step after this one" for
// persisting a new wait, since `steps` itself may already be a suffix.
async function runSteps(
  workflow: WorkflowWithSteps,
  order: Order,
  steps: WorkflowStep[],
  context: WorkflowContext,
  options: RunWorkflowOptions
): Promise<void> {
  for (const step of steps) {
    if (options.skipStepOrders?.has(step.step_order)) {
      continue;
    }

    const startedAt = new Date();
    const moduleImpl = getAutomationModule(step.module_name);

    // A step referencing an unregistered module (or one that's since been
    // removed) never stops the rest of the workflow — recorded as a failed
    // attempt, same as any other step failure.
    if (!moduleImpl) {
      await recordWorkflowExecution({
        workflowId: workflow.id,
        orderId: order.id,
        stepOrder: step.step_order,
        moduleName: step.module_name,
        startedAt,
        status: "failed",
        message: `No automation module registered for "${step.module_name}".`,
      });
      continue;
    }

    // Circuit breaker: this exact step has failed
    // CONSECUTIVE_FAILURE_THRESHOLD times in a row — skip calling the
    // module again and record why, rather than repeating a call that's
    // already shown it won't succeed (a dead endpoint, revoked
    // credentials). The next order still gets its own check, so a fix to
    // the underlying problem (or the module simply succeeding once) closes
    // the circuit again automatically.
    if (await isCircuitOpen(workflow.id, step.step_order, step.module_name)) {
      await recordWorkflowExecution({
        workflowId: workflow.id,
        orderId: order.id,
        stepOrder: step.step_order,
        moduleName: step.module_name,
        startedAt,
        status: "failed",
        message: `Circuit open: ${CONSECUTIVE_FAILURE_THRESHOLD} consecutive failures for this step — skipped without retrying.`,
      });
      continue;
    }

    try {
      const shouldRun = moduleImpl.shouldRun
        ? await moduleImpl.shouldRun(order, step.config, context)
        : true;

      if (!shouldRun) {
        await recordWorkflowExecution({
          workflowId: workflow.id,
          orderId: order.id,
          stepOrder: step.step_order,
          moduleName: step.module_name,
          startedAt,
          status: "success",
          message: "Skipped (shouldRun returned false).",
        });
        continue;
      }

      const result = await moduleImpl.run(order, step.config, context);

      if (result.data) {
        context[step.module_name] = result.data;
      }

      // "stop"/"waiting" take priority over `success` — a module setting
      // either one is making a control-flow decision, not reporting a
      // pass/fail outcome, so it's recorded as a successful step
      // regardless of whatever `success` value the module also set.
      if (result.outcome === "stop" || result.outcome === "waiting") {
        // "waiting" additionally persists where to pick back up — but only
        // when there's actually a next step to resume at; a "waiting" step
        // that happens to be last in the workflow has nothing left to
        // continue into, so it behaves exactly like "stop" instead.
        const nextStep =
          result.outcome === "waiting"
            ? workflow.steps.find((s) => s.step_order > step.step_order)
            : undefined;

        if (nextStep) {
          await persistWorkflowWait({
            workflowId: workflow.id,
            orderId: order.id,
            resumeStepId: nextStep.id,
            context,
            resumeAt: computeResumeAt(result.data),
          });
        }

        await recordWorkflowExecution({
          workflowId: workflow.id,
          orderId: order.id,
          stepOrder: step.step_order,
          moduleName: step.module_name,
          startedAt,
          status: "success",
          message:
            result.outcome === "stop"
              ? `Workflow stopped: ${result.message ?? "no reason given"}.`
              : nextStep
                ? `Workflow paused: ${result.message ?? "no reason given"}. Resumes automatically at step ${nextStep.step_order}.`
                : `Workflow paused (this was the last step, nothing to resume): ${result.message ?? "no reason given"}.`,
        });
        logger.info("workflow.execution_halted", {
          workflowId: workflow.id,
          orderId: order.id,
          stepOrder: step.step_order,
          moduleName: step.module_name,
          outcome: result.outcome,
          willResume: !!nextStep,
        });
        // Halts the rest of THIS workflow's steps — dispatch.handleEvent()
        // still moves on to the next matching workflow, if any; one
        // workflow stopping/pausing has no effect on any other. A paused
        // run's remaining steps are picked up later by resumeWorkflow(),
        // driven by the automation-retry cron — never by this function
        // itself.
        return;
      }

      if (result.outcome === "retry") {
        await recordWorkflowExecution({
          workflowId: workflow.id,
          orderId: order.id,
          stepOrder: step.step_order,
          moduleName: step.module_name,
          startedAt,
          status: "failed",
          message: `Retry requested: ${result.message ?? "no reason given"}.`,
        });
        logger.warn("workflow.retry_requested", {
          workflowId: workflow.id,
          orderId: order.id,
          stepOrder: step.step_order,
          moduleName: step.module_name,
        });
        // A retry request is scoped to this one step, not the whole run —
        // proceed to the next step exactly like any other step failure.
        // The automation-retry cron is what actually retries it later
        // (same mechanism as a plain failure — see lib/workflows/retry.ts).
        continue;
      }

      await recordWorkflowExecution({
        workflowId: workflow.id,
        orderId: order.id,
        stepOrder: step.step_order,
        moduleName: step.module_name,
        startedAt,
        status: result.success ? "success" : "failed",
        message: result.message,
      });
    } catch (err) {
      console.error(
        `runWorkflow: step ${step.step_order} (${step.module_name}) failed for order ${order.id}:`,
        err
      );
      // message is a fixed, user-safe string — never the caught error
      // itself, same rule as syncShopProducts()/syncShopOrders(). This
      // branch only fires for a module that throws instead of returning a
      // failed ModuleResult (a bug in that module, not an expected outcome).
      await recordWorkflowExecution({
        workflowId: workflow.id,
        orderId: order.id,
        stepOrder: step.step_order,
        moduleName: step.module_name,
        startedAt,
        status: "failed",
        message: `Module "${step.module_name}" failed to run.`,
      });
    }
  }
}

// Sequential step orchestrator — the direct evolution of runSyncForShops()
// (lib/sync.ts): same philosophy, one try/catch per unit of work (a step,
// instead of a shop), continuing past an isolated failure instead of
// aborting the whole run. Never called by the Webhook or a Server Action
// directly — only by dispatch.handleEvent(), once the Workflow Manager has
// already resolved which workflows apply (and by retryFailedWorkflowExecutions
// / "Test Workflow Now", both of which reuse this same function rather than
// a second execution path).
export async function runWorkflow(
  workflow: WorkflowWithSteps,
  order: Order,
  options: RunWorkflowOptions = {}
): Promise<void> {
  if (!assertSameShop(workflow, order)) {
    return;
  }

  // Accumulates each step's structured output (ModuleResult.data), keyed by
  // module_name, so a later step (Tag Order, Condition, ...) can read what
  // an earlier one (AI Agent, ...) produced. Local to a single run — never
  // persisted as its own object, only ever indirectly via each step's own
  // workflow_executions row (or, for a paused run, via a workflow_waits
  // row — see persistWorkflowWait above).
  const context: WorkflowContext = {};

  await runSteps(workflow, order, workflow.steps, context, options);
}

// Continues a workflow run that previously paused on a "waiting" outcome —
// called exclusively by the automation-retry cron once a workflow_waits row
// becomes due (lib/workflows/resume.ts's getDueWorkflowWaits/
// claimWorkflowWait). Picks up at `fromStepOrder` (the wait's own
// resume_step_order) with `context` restored from the wait row, so a step
// after the resume point sees exactly what it would have if the run had
// never paused. Never re-runs anything before fromStepOrder — those steps
// already have their own workflow_executions rows from the original run.
export async function resumeWorkflow(
  workflow: WorkflowWithSteps,
  order: Order,
  fromStepOrder: number,
  context: WorkflowContext
): Promise<void> {
  if (!assertSameShop(workflow, order)) {
    return;
  }

  logger.info("workflow.execution_resumed", {
    workflowId: workflow.id,
    orderId: order.id,
    fromStepOrder,
  });

  const remainingSteps = workflow.steps.filter((step) => step.step_order >= fromStepOrder);
  await runSteps(workflow, order, remainingSteps, context, {});
}
