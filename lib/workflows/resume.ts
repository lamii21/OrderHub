import { supabase } from "@/lib/supabase";
import type { WorkflowWait } from "@/types/workflow";
import type { WorkflowContext } from "@/lib/automation-modules/types";

type PersistWorkflowWaitInput = {
  workflowId: number;
  orderId: number;
  resumeStepId: number;
  context: WorkflowContext;
  resumeAt: Date;
};

// Called by lib/workflows/engine.ts the moment a step returns outcome
// "waiting" — the one write path for this table (service-role client, same
// as recordWorkflowExecution). Never throws: a failed write here means the
// pause is lost and the workflow simply doesn't resume automatically,
// which is a silent degradation, not a corruption — same "log and move on"
// posture as every other Execution Engine write.
export async function persistWorkflowWait(input: PersistWorkflowWaitInput): Promise<void> {
  const { error } = await supabase.from("workflow_waits").insert({
    workflow_id: input.workflowId,
    order_id: input.orderId,
    resume_step_id: input.resumeStepId,
    context: input.context,
    resume_at: input.resumeAt.toISOString(),
  });

  if (error) {
    console.error("persistWorkflowWait failed:", error);
  }
}

// Every unconsumed wait whose resume_at has passed — the resume cron's own
// selection query. Ordered oldest-due-first, same "whoever has waited
// longest goes first when there's a backlog" reasoning as the sync cron's
// shop ordering. `limit` bounds one cron invocation's work the same way
// MAX_SHOPS_PER_RUN bounds the sync cron.
export async function getDueWorkflowWaits(limit: number): Promise<WorkflowWait[]> {
  const { data, error } = await supabase
    .from("workflow_waits")
    .select("*")
    .is("consumed_at", null)
    .lte("resume_at", new Date().toISOString())
    .order("resume_at", { ascending: true })
    .limit(limit)
    .returns<WorkflowWait[]>();

  if (error) {
    console.error("getDueWorkflowWaits failed:", error);
    return [];
  }

  return data ?? [];
}

// Optimistic-concurrency claim, same sentinel-park shape as
// swapStepOrder() (app/shops/[id]/workflows/[workflowId]/actions.ts): the
// update's own `.is("consumed_at", null)` predicate means only the first
// caller to run this for a given wait actually updates a row — a second,
// overlapping cron invocation (or a retried cron tick) racing for the same
// wait sees 0 affected rows and knows to skip it, rather than resuming the
// same workflow twice from the same pause.
export async function claimWorkflowWait(waitId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("workflow_waits")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", waitId)
    .is("consumed_at", null)
    .select("id");

  if (error) {
    console.error("claimWorkflowWait failed:", error);
    return false;
  }

  return (data?.length ?? 0) > 0;
}
