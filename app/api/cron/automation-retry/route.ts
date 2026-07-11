import { NextRequest, NextResponse } from "next/server";
import { matchesAnySecret, requireEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { resumeWorkflow } from "@/lib/workflows/engine";
import { getDueWorkflowWaits, claimWorkflowWait } from "@/lib/workflows/resume";
import { retryWorkflowExecutions, getBackoffEligiblePairs } from "@/lib/workflows/retry";
import { runWithConcurrency } from "@/lib/concurrency";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import type { WorkflowStep, WorkflowWithSteps } from "@/types/workflow";
import type { Order } from "@/types/order";

// Same reasoning as /api/cron/sync's own maxDuration: this run can resume
// up to MAX_WAITS_PER_RUN paused workflows and retry a backlog of failed
// ones, each involving real external calls (WhatsApp, a webhook, ...) with
// their own timeouts.
export const maxDuration = 300;

// However many due waits are actually resumed in one run — the rest stay
// due (resume_at doesn't change) and are picked up next tick. Same
// "bound one invocation's wall-clock time, accept an occasional extra
// cycle of delay under a big backlog" trade-off as MAX_SHOPS_PER_RUN.
const MAX_WAITS_PER_RUN = 50;

// Same bounded-fan-out reasoning as lib/sync.ts's SYNC_CONCURRENCY — see
// lib/concurrency.ts's own comment for the incident that pattern fixed.
const RESUME_CONCURRENCY = 10;

// How far back the retry side looks for failed executions worth
// considering — a rolling window (not startOfTodayUTC()) since this runs
// repeatedly across day boundaries, unlike the Admin Center's manual,
// one-off "retry today's failures" button (app/admin/actions.ts).
const RETRY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function isValidCronSecret(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;

  requireEnv("CRON_SECRET"); // fail fast if the primary secret isn't configured at all
  const provided = authHeader.slice("Bearer ".length);
  return matchesAnySecret(provided, "CRON_SECRET", "CRON_SECRET_PREVIOUS");
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

type WorkflowRow = WorkflowWithSteps & { workflow_steps: WorkflowStep[] };

// Resumes every due, unconsumed workflow_waits row — claims each one first
// (optimistic concurrency: see claimWorkflowWait's own comment) so an
// overlapping invocation of this same cron can never resume the same
// paused workflow twice. Batches the workflow/order lookups the same way
// retryWorkflowExecutions() does, rather than one round trip per wait.
async function resumeDueWaits(): Promise<{ resumed: number; dueCount: number }> {
  const dueWaits = await getDueWorkflowWaits(MAX_WAITS_PER_RUN);

  if (dueWaits.length === 0) {
    return { resumed: 0, dueCount: 0 };
  }

  const workflowIds = Array.from(new Set(dueWaits.map((w) => w.workflow_id)));
  const orderIds = Array.from(new Set(dueWaits.map((w) => w.order_id)));

  const [{ data: workflows, error: workflowsError }, { data: orders, error: ordersError }] =
    await Promise.all([
      supabase.from("workflows").select("*, workflow_steps(*)").in("id", workflowIds),
      supabase.from("orders").select("*, shops(name, platform)").in("id", orderIds),
    ]);

  if (workflowsError || ordersError) {
    console.error(
      "automation-retry cron: failed to load data needed to resume waits:",
      workflowsError ?? ordersError
    );
    return { resumed: 0, dueCount: dueWaits.length };
  }

  const workflowsById = new Map<number, WorkflowWithSteps>(
    ((workflows ?? []) as WorkflowRow[]).map((workflow) => {
      const { workflow_steps, ...workflowFields } = workflow;
      const steps = [...workflow_steps].sort((a, b) => a.step_order - b.step_order);
      return [workflow.id, { ...workflowFields, steps }];
    })
  );
  const ordersById = new Map(((orders ?? []) as Order[]).map((order) => [order.id, order]));

  let resumed = 0;

  await runWithConcurrency(dueWaits, RESUME_CONCURRENCY, async (wait) => {
    const workflow = workflowsById.get(wait.workflow_id);
    const order = ordersById.get(wait.order_id);

    if (!workflow || !order) {
      return;
    }

    // resume_step_id is a stable workflow_steps.id, not the step_order
    // snapshotted when the wait was created — the workflow stays editable
    // while a wait is pending, and step_order gets reassigned by
    // moveWorkflowStepUp/Down and renumberSteps (see the column's own
    // comment in schema.sql). Resolved against the workflow's CURRENT
    // steps, loaded moments ago, so this always reflects the real
    // position — or its absence — right now.
    const targetStep = wait.resume_step_id
      ? workflow.steps.find((s) => s.id === wait.resume_step_id)
      : undefined;

    // Claimed regardless of whether the target step still exists — a wait
    // whose step was deleted has nothing left to resume into and never
    // will, so it's handled once (logged, left consumed) rather than
    // resurfacing as due on every cron tick forever.
    const claimed = await claimWorkflowWait(wait.id);
    if (!claimed) {
      return;
    }

    if (!targetStep) {
      console.error(
        `automation-retry cron: wait ${wait.id}'s target step no longer exists — the workflow was edited while this pause was pending. Skipping.`
      );
      return;
    }

    try {
      await resumeWorkflow(workflow, order, targetStep.step_order, wait.context);
      resumed++;
    } catch (err) {
      console.error(`automation-retry cron: failed to resume wait ${wait.id}:`, err);
    }
  });

  return { resumed, dueCount: dueWaits.length };
}

// Triggered on a schedule (Vercel Cron — see vercel.json), never by a
// browser. Two independent jobs in one invocation, same "one cron, several
// unrelated maintenance tasks" shape /api/cron/sync could have split into
// two crons but didn't: resuming paused workflows and retrying failed ones
// are both small, fast, and share the same auth/rate-limit boilerplate, so
// one endpoint is simpler to schedule and reason about than two.
export async function GET(request: NextRequest) {
  const rateLimit = checkRateLimit(`cron:${clientIp(request)}`, { max: 10, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    logger.warn("cron.rate_limited", { ip: clientIp(request), cron: "automation-retry" });
    return NextResponse.json(
      { success: false, error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000)) } }
    );
  }

  if (!isValidCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { resumed, dueCount } = await resumeDueWaits();
  if (dueCount > resumed) {
    logger.warn("cron.automation_retry.resume_backlog", { due: dueCount, resumed });
  }

  const { pairs, skipStepOrdersByPair } = await getBackoffEligiblePairs(supabase, RETRY_LOOKBACK_MS);
  const retried = await retryWorkflowExecutions(supabase, pairs, skipStepOrdersByPair);

  return NextResponse.json({
    success: true,
    waits: { due: dueCount, resumed },
    retries: { eligible: pairs.length, retried },
  });
}
