import { supabase } from "@/lib/supabase";
import type { WorkflowExecutionWithWorkflow } from "@/types/workflow";

type RecordWorkflowExecutionInput = {
  workflowId: number;
  orderId: number;
  stepOrder: number;
  moduleName: string;
  startedAt: Date;
  status: "success" | "failed";
  message?: string;
};

// ==== Writes ====

// Calqued directly on lib/sync-history.ts's recordSyncHistory(), down to
// the column choices: service-role client (only the Execution Engine ever
// writes workflow_executions, matching its RLS — see schema.sql), duration
// computed here from startedAt. message must already be a user-safe string
// by the time it arrives — this function doesn't sanitize it, the caller
// does (never pass a raw caught error or its stack trace).
export async function recordWorkflowExecution(input: RecordWorkflowExecutionInput) {
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - input.startedAt.getTime();

  const { error } = await supabase.from("workflow_executions").insert({
    workflow_id: input.workflowId,
    order_id: input.orderId,
    step_order: input.stepOrder,
    module_name: input.moduleName,
    status: input.status,
    message: input.message ?? null,
    duration_ms: durationMs,
    started_at: input.startedAt.toISOString(),
  });

  if (error) {
    console.error("Failed to record workflow execution:", error);
  }
}

// ==== Reads ====
// Same shape as every other history read in this app (sync_history's own
// inline reads on app/admin/page.tsx): a plain typed query function,
// newest-first, logging and returning an empty array on error rather than
// throwing — a history read is always secondary to whatever page it backs,
// never something that should take the whole page down.

// Every execution ever recorded against one order, across every workflow
// that has run on it — the read behind app/orders/[id]/page.tsx's
// Automation/Timeline section (that page currently does this same query
// inline; this is the reusable version of it, not a replacement for it).
// No limit: a single order realistically has a handful of executions at
// most, the same "just read all of it" choice that page already makes.
export async function getExecutionsForOrder(
  orderId: number
): Promise<WorkflowExecutionWithWorkflow[]> {
  const { data, error } = await supabase
    .from("workflow_executions")
    .select("*, workflows(name)")
    .eq("order_id", orderId)
    .order("started_at", { ascending: false })
    .returns<WorkflowExecutionWithWorkflow[]>();

  if (error) {
    console.error("getExecutionsForOrder failed:", error);
    return [];
  }

  return data ?? [];
}

// The most recent N executions for one workflow, across every order it has
// run against — same "recent N" convention as every list-style section on
// /admin.
export async function getRecentExecutionsForWorkflow(
  workflowId: number,
  limit = 15
): Promise<WorkflowExecutionWithWorkflow[]> {
  const { data, error } = await supabase
    .from("workflow_executions")
    .select("*, workflows(name)")
    .eq("workflow_id", workflowId)
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<WorkflowExecutionWithWorkflow[]>();

  if (error) {
    console.error("getRecentExecutionsForWorkflow failed:", error);
    return [];
  }

  return data ?? [];
}

// ==== Statistics ====

export type WorkflowExecutionStats = {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  // null (not 0) when there are no executions yet — "0% success" and "no
  // data yet" are different facts, and collapsing them would misreport a
  // freshly-created workflow that has simply never run as if it were
  // failing.
  successRate: number | null;
};

// Success/failure counts scoped to ONE workflow.
// get_workflow_performance_stats() (schema.sql) already computes this
// shape but globally, across every workflow on the account; nothing
// currently answers it for a single one. 2 head-only count queries (never
// fetching the actual rows) — same dual-count pattern already used for
// "executions today"/"failed executions today" on app/admin/page.tsx, just
// scoped by workflow_id instead of a date range.
export async function getExecutionStatsForWorkflow(
  workflowId: number
): Promise<WorkflowExecutionStats> {
  const [totalResult, successResult] = await Promise.all([
    supabase
      .from("workflow_executions")
      .select("*", { count: "exact", head: true })
      .eq("workflow_id", workflowId),
    supabase
      .from("workflow_executions")
      .select("*", { count: "exact", head: true })
      .eq("workflow_id", workflowId)
      .eq("status", "success"),
  ]);

  if (totalResult.error || successResult.error) {
    console.error(
      "getExecutionStatsForWorkflow failed:",
      totalResult.error ?? successResult.error
    );
    return { totalExecutions: 0, successCount: 0, failureCount: 0, successRate: null };
  }

  const totalExecutions = totalResult.count ?? 0;
  const successCount = successResult.count ?? 0;
  const failureCount = totalExecutions - successCount;
  const successRate =
    totalExecutions > 0 ? Math.round((successCount / totalExecutions) * 1000) / 10 : null;

  return { totalExecutions, successCount, failureCount, successRate };
}

// ==== Helpers ====
// Pure, no I/O — formalize 2 grouping patterns already duplicated inline
// elsewhere (app/dashboard/page.tsx's per-order automation status,
// app/admin/actions.ts's retryFailedWorkflowExecutions dedup). Neither call
// site is refactored to use these by this change; they exist so a future
// caller doesn't have to reinvent either one.

// Reduces a list of executions down to one per order_id — whichever one
// appears first for that order. Precondition: pass a newest-first list
// (every read above already returns one) to get "most recent execution
// per order" out of it; this function itself does not sort.
export function latestExecutionByOrderId<T extends { order_id: number }>(
  executions: T[]
): Map<number, T> {
  const latest = new Map<number, T>();

  for (const execution of executions) {
    if (!latest.has(execution.order_id)) {
      latest.set(execution.order_id, execution);
    }
  }

  return latest;
}

// Collapses several execution rows for the same (workflow, order) pair —
// e.g. 3 failed steps from one run — down to one representative row per
// pair. Keeps the LAST row seen for a given pair (a plain JS Map's own
// behavior when built from repeated keys) — the same dedup shape already
// used inline by app/admin/actions.ts's retryFailedWorkflowExecutions, so
// this preserves that existing "last one wins" behavior rather than
// quietly changing it. Pass a sorted list if a specific occurrence (e.g.
// the most recent) needs to be the one that wins.
export function uniqueByWorkflowAndOrder<T extends { workflow_id: number; order_id: number }>(
  executions: T[]
): T[] {
  return Array.from(new Map(executions.map((e) => [`${e.workflow_id}:${e.order_id}`, e])).values());
}
