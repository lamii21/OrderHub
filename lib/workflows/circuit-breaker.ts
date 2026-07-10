import { supabase } from "@/lib/supabase";

// Reuses workflow_executions — the Execution History table that already
// exists — rather than a new table or in-memory failure counter (which
// wouldn't survive a serverless cold start anyway). A step whose last
// CONSECUTIVE_FAILURE_THRESHOLD attempts all failed is almost certainly
// hitting a genuinely broken integration (revoked credentials, a dead
// endpoint), not a transient blip: retrying it on every single order in
// the meantime only burns API quota and adds latency for a result that's
// already known. The breaker resets itself automatically the moment one
// attempt succeeds — no separate "half-open" timer to manage.
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

// step_order alone is NOT a stable identity — reordering a workflow's steps
// (moveWorkflowStepUp/Down) repoints it at a different module instantly,
// and removeWorkflowStep()'s renumbering can shift an unrelated step into a
// position that just had 3 failures recorded against it. Filtering on
// module_name too means a step only ever reads *its own* module's past
// attempts: if a merchant deletes a failing WhatsApp step and adds a new
// Update Status step in the same position, the new step's history starts
// empty instead of inheriting WhatsApp's open circuit. The trade-off is
// that a step's own failure streak doesn't survive being moved to a
// different position — an acceptable loss (it just starts counting again)
// compared to gating the wrong module.
export async function isCircuitOpen(
  workflowId: number,
  stepOrder: number,
  moduleName: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("workflow_executions")
    .select("status")
    .eq("workflow_id", workflowId)
    .eq("step_order", stepOrder)
    .eq("module_name", moduleName)
    .order("started_at", { ascending: false })
    .limit(CONSECUTIVE_FAILURE_THRESHOLD);

  if (error || !data || data.length < CONSECUTIVE_FAILURE_THRESHOLD) {
    return false;
  }

  return data.every((row) => row.status === "failed");
}

export { CONSECUTIVE_FAILURE_THRESHOLD };
