import type { SupabaseClient } from "@supabase/supabase-js";
import { runWorkflow } from "./engine";
import { isCircuitOpen } from "./circuit-breaker";
import { runWithConcurrency } from "@/lib/concurrency";
import type { WorkflowStep, WorkflowWithSteps } from "@/types/workflow";
import type { Order } from "@/types/order";

type WorkflowOrderPair = { workflow_id: number; order_id: number };

// Same bounded-fan-out reasoning as lib/sync.ts's SYNC_CONCURRENCY: a
// backlog of failed (workflow, order) pairs retried fully sequentially —
// each one making its own real external calls (WhatsApp, a webhook, ...) —
// could run well past the automation-retry cron's own time limit, the
// exact incident that pattern was already built to avoid.
const RETRY_CONCURRENCY = 10;

// Same "accept the caller's own client" shape as applyOrderStatusChange()
// (lib/orders.ts) — this module has two very different callers: the Admin
// Center's manual "Retry Failed Executions" button (an authenticated Server
// Action, RLS-scoped to the caller's own shops) and the automation-retry
// cron (no user session at all, needs the service-role client to see every
// tenant's failures). Neither is hard-coded here; each passes its own.
type Db = SupabaseClient;

// Shared core: given a list of (workflow, order) pairs known to have at
// least one failed step, re-runs each one through the exact same
// runWorkflow() the Execution Engine calls in production — never a second
// execution path (same "Test Workflow Now" precedent). Idempotent by
// construction: any step that already succeeded for this pair is derived
// here (from workflow_executions itself, not a separate counter) and
// skipped, so a retry can never re-send a WhatsApp message, re-create a
// shipment, etc. that already went out. `extraSkipStepOrdersByPair` layers
// on top of that — the automation-retry cron uses it to additionally skip
// a failed step that isn't backoff-eligible yet (see
// getBackoffEligiblePairs below); the manual "Retry Failed Executions"
// admin action passes nothing extra, since a human clicking that button
// wants everything failed retried right now, not gated by a cron's backoff
// schedule.
export async function retryWorkflowExecutions(
  db: Db,
  pairs: WorkflowOrderPair[],
  extraSkipStepOrdersByPair?: Map<string, Set<number>>
): Promise<number> {
  if (pairs.length === 0) {
    return 0;
  }

  const workflowIds = Array.from(new Set(pairs.map((p) => p.workflow_id)));
  const orderIds = Array.from(new Set(pairs.map((p) => p.order_id)));

  // 3 batched lookups instead of up to 2 queries per pair in a loop — a
  // backlog of, say, 40 distinct failed (workflow, order) pairs is always
  // exactly 3 round trips, however many pairs there are. Safe to run in
  // parallel: none of these three depend on each other's result, they're
  // only joined together afterward in memory.
  const [
    { data: workflows, error: workflowsError },
    { data: orders, error: ordersError },
    { data: succeededSteps, error: succeededError },
  ] = await Promise.all([
    db.from("workflows").select("*, workflow_steps(*)").in("id", workflowIds),
    db.from("orders").select("*, shops(name, platform)").in("id", orderIds),
    db
      .from("workflow_executions")
      .select("workflow_id, order_id, step_order")
      .eq("status", "success")
      .in("workflow_id", workflowIds)
      .in("order_id", orderIds),
  ]);

  if (workflowsError || ordersError || succeededError) {
    console.error(
      "retryWorkflowExecutions: failed to load retry data:",
      workflowsError ?? ordersError ?? succeededError
    );
    return 0;
  }

  const workflowsById = new Map<number, WorkflowWithSteps>(
    (workflows ?? []).map((workflow: Record<string, unknown> & { id: number; workflow_steps: WorkflowStep[] }) => {
      const { workflow_steps, ...workflowFields } = workflow;
      const steps = [...workflow_steps].sort((a, b) => a.step_order - b.step_order);
      return [workflow.id, { ...workflowFields, steps } as WorkflowWithSteps];
    })
  );
  const ordersById = new Map((orders ?? []).map((order: { id: number }) => [order.id, order]));

  const succeededStepsByPair = new Map<string, Set<number>>();
  for (const row of succeededSteps ?? []) {
    const key = `${row.workflow_id}:${row.order_id}`;
    const set = succeededStepsByPair.get(key) ?? new Set<number>();
    set.add(row.step_order);
    succeededStepsByPair.set(key, set);
  }

  let retried = 0;

  await runWithConcurrency(pairs, RETRY_CONCURRENCY, async ({ workflow_id, order_id }) => {
    const workflow = workflowsById.get(workflow_id);
    const order = ordersById.get(order_id);

    if (!workflow || !order) {
      return;
    }

    const key = `${workflow_id}:${order_id}`;
    const succeeded = succeededStepsByPair.get(key) ?? new Set<number>();
    const extra = extraSkipStepOrdersByPair?.get(key) ?? new Set<number>();
    const combined = new Set([...succeeded, ...extra]);
    // undefined (not an empty Set) when nothing is skipped — engine.ts
    // treats both identically (`options.skipStepOrders?.has(...)` is
    // falsy either way), but this keeps a skipStepOrders: undefined call
    // visibly distinguishable from an explicit "skip nothing" Set in
    // anything asserting on the exact call, e.g. tests.
    const skipStepOrders = combined.size > 0 ? combined : undefined;

    try {
      await runWorkflow(workflow, order as Order, { skipStepOrders });
      retried++;
    } catch (err) {
      console.error(
        `retryWorkflowExecutions: retry failed for workflow ${workflow_id}, order ${order_id}:`,
        err
      );
    }
  });

  return retried;
}

// Backoff between automatic retry attempts, indexed by (consecutive
// failure count - 1): 5 minutes after the 1st failure, 30 minutes after
// the 2nd. There's deliberately no 3rd entry — the circuit breaker's own
// CONSECUTIVE_FAILURE_THRESHOLD (3) is the one "give up automatically"
// signal (see circuit-breaker.ts); this module reuses it rather than
// defining a second, possibly-inconsistent threshold. Once a step's
// circuit is open, the automation-retry cron stops selecting it entirely —
// it stays visible (and retryable by hand) in the Admin Error Center.
const RETRY_BACKOFF_MS = [5 * 60_000, 30 * 60_000];

type FailingStepGroup = {
  workflowId: number;
  orderId: number;
  stepOrder: number;
  moduleName: string;
  lastAttemptAt: number;
  failureCount: number;
};

// Selects which (workflow, order) pairs the automation-retry cron should
// actually retry right now, purely by reading workflow_executions history
// — no retry-count/next-retry-at columns anywhere (same "derive from the
// log, don't maintain a second source of truth" precedent as the circuit
// breaker itself). A pair is included once it has at least one failed step
// that is both backoff-eligible (enough time has passed since its last
// attempt) and not circuit-open; every OTHER failed step for that same
// pair — still backing off, or circuit-open — is returned in
// skipStepOrdersByPair so retryWorkflowExecutions() skips exactly those
// and nothing else, rather than either retrying a not-yet-eligible step
// early or silently dropping the whole pair because one of its steps isn't
// ready yet.
export async function getBackoffEligiblePairs(
  db: Db,
  lookbackWindowMs: number
): Promise<{ pairs: WorkflowOrderPair[]; skipStepOrdersByPair: Map<string, Set<number>> }> {
  const since = new Date(Date.now() - lookbackWindowMs);

  const { data: failedExecutions, error } = await db
    .from("workflow_executions")
    .select("workflow_id, order_id, step_order, module_name, started_at")
    .eq("status", "failed")
    .gte("started_at", since.toISOString());

  if (error) {
    console.error("getBackoffEligiblePairs: failed to load failed executions:", error);
    return { pairs: [], skipStepOrdersByPair: new Map() };
  }

  // Grouped by the same identity the circuit breaker uses
  // (workflow_id, step_order, module_name) — a step that was reassigned to
  // a different module in between attempts starts its failure count over,
  // same reasoning as isCircuitOpen()'s own module_name filter.
  const stepGroups = new Map<string, FailingStepGroup>();

  for (const row of failedExecutions ?? []) {
    const key = `${row.workflow_id}:${row.order_id}:${row.step_order}:${row.module_name}`;
    const attemptAt = new Date(row.started_at).getTime();
    const existing = stepGroups.get(key);

    if (existing) {
      existing.failureCount += 1;
      existing.lastAttemptAt = Math.max(existing.lastAttemptAt, attemptAt);
    } else {
      stepGroups.set(key, {
        workflowId: row.workflow_id,
        orderId: row.order_id,
        stepOrder: row.step_order,
        moduleName: row.module_name,
        lastAttemptAt: attemptAt,
        failureCount: 1,
      });
    }
  }

  const eligiblePairKeys = new Set<string>();
  const skipStepOrdersByPair = new Map<string, Set<number>>();

  for (const group of stepGroups.values()) {
    const pairKey = `${group.workflowId}:${group.orderId}`;
    const circuitOpen = await isCircuitOpen(group.workflowId, group.stepOrder, group.moduleName);
    const backoffMs = RETRY_BACKOFF_MS[Math.min(group.failureCount - 1, RETRY_BACKOFF_MS.length - 1)];
    const eligible = !circuitOpen && Date.now() - group.lastAttemptAt >= backoffMs;

    if (eligible) {
      eligiblePairKeys.add(pairKey);
    } else {
      const set = skipStepOrdersByPair.get(pairKey) ?? new Set<number>();
      set.add(group.stepOrder);
      skipStepOrdersByPair.set(pairKey, set);
    }
  }

  const pairs = Array.from(eligiblePairKeys, (key) => {
    const [workflowIdStr, orderIdStr] = key.split(":");
    return { workflow_id: Number(workflowIdStr), order_id: Number(orderIdStr) };
  });

  return { pairs, skipStepOrdersByPair };
}
