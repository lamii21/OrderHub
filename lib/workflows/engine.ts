import { getAutomationModule } from "@/lib/automation-modules";
import { recordWorkflowExecution } from "./execution-history";
import { isCircuitOpen, CONSECUTIVE_FAILURE_THRESHOLD } from "./circuit-breaker";
import type { WorkflowContext } from "@/lib/automation-modules/types";
import type { WorkflowWithSteps } from "@/types/workflow";
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
  // Accumulates each step's structured output (ModuleResult.data), keyed by
  // module_name, so a later step (Tag Order, Condition, ...) can read what
  // an earlier one (AI Agent, ...) produced. Local to a single run — never
  // persisted as its own object, only ever indirectly via each step's own
  // workflow_executions row.
  const context: WorkflowContext = {};

  for (const step of workflow.steps) {
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
