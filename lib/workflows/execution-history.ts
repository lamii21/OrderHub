import { supabase } from "@/lib/supabase";

type RecordWorkflowExecutionInput = {
  workflowId: number;
  orderId: number;
  stepOrder: number;
  moduleName: string;
  startedAt: Date;
  status: "success" | "failed";
  message?: string;
};

// Calqued directly on lib/sync-history.ts's recordSyncHistory(), down to the
// column choices: service-role client (only the Execution Engine ever
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
