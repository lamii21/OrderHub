import { supabase } from "@/lib/supabase";
import type { EventType } from "@/lib/events/types";
import type { WorkflowStep, WorkflowWithSteps } from "@/types/workflow";

// Pure read: given (shop_id, event_type), return every active workflow that
// should react, with its steps already ordered. Zero side effects, zero
// external calls — the recipe, never the cooking. No interface: only one
// implementation will ever exist, so one would be a gratuitous abstraction
// (see the Workflow Engine dossier's own reasoning for this layer).
//
// Runs on the service-role client, same as lib/sync.ts throughout: this is
// a system-level read triggered by a webhook or a status-change dispatch,
// never a user-scoped page load, so there's no user session to run it as.
// RLS still fully protects this data for any future user-facing read (e.g.
// a Workflow Builder UI reading its own workflows as the logged-in user).
export async function resolveWorkflows(
  shopId: number,
  eventType: EventType
): Promise<WorkflowWithSteps[]> {
  const { data, error } = await supabase
    .from("workflows")
    .select("*, workflow_steps(*)")
    .eq("shop_id", shopId)
    .eq("trigger_event", eventType)
    .eq("is_active", true);

  if (error) {
    console.error("resolveWorkflows failed:", error);
    return [];
  }

  return (data ?? []).map((workflow) => {
    const { workflow_steps, ...rest } = workflow as WorkflowWithSteps & {
      workflow_steps: WorkflowStep[];
    };

    return {
      ...rest,
      steps: [...workflow_steps].sort((a, b) => a.step_order - b.step_order),
    };
  });
}
