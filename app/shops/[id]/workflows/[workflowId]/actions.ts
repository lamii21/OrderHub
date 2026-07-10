"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isValidEventType, type EventType } from "@/lib/events/types";
import { getAutomationModule } from "@/lib/automation-modules";
import { runWorkflow } from "@/lib/workflows/engine";
import { parsePositiveInt } from "@/lib/validation";
import { logger } from "@/lib/logger";
import type { WorkflowStep } from "@/types/workflow";
import type { Order } from "@/types/order";

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type WorkflowRow = {
  id: number;
  shop_id: number;
  name: string;
  trigger_event: EventType;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
};

// Generous, not strict — same "catch obviously wrong input, not enforce a
// precise format" spirit as lib/validation.ts's MAX_TEXT_FIELD_LENGTH. A
// module's config is normally a handful of short fields (a phone number, a
// webhook URL, a message template); 10KB is orders of magnitude past any
// real one while still stopping a pasted multi-megabyte blob from landing
// in a jsonb column on every workflow execution read.
const MAX_STEP_CONFIG_LENGTH = 10_000;

// Shared by activateWorkflow() and runWorkflowNow() — both need the
// workflow's steps already ordered, neither should duplicate this fetch.
async function loadWorkflowWithSteps(
  supabase: ServerSupabase,
  workflowId: number
): Promise<(WorkflowRow & { steps: WorkflowStep[] }) | null> {
  const { data, error } = await supabase
    .from("workflows")
    .select("*, workflow_steps(*)")
    .eq("id", workflowId)
    .single();

  if (error || !data) {
    return null;
  }

  const { workflow_steps, ...workflow } = data as WorkflowRow & { workflow_steps: WorkflowStep[] };

  return {
    ...workflow,
    steps: [...workflow_steps].sort((a, b) => a.step_order - b.step_order),
  };
}

// workflow_steps has a unique (workflow_id, step_order) index, so a plain
// two-call swap would collide mid-flight — each .update() is its own
// statement, there's no single atomic "swap" available through PostgREST
// without a stored procedure. Routing the current row through step_order 0
// (never a real value; step_order always starts at 1) sidesteps the
// constraint with 3 individually-valid updates instead.
//
// Each write is guarded by .eq("step_order", <the value this function read
// moments ago>) and re-selects the affected row: if a second concurrent
// move (another browser tab, a double-click firing the same form twice)
// already changed that row's step_order, the predicate matches nothing,
// the affected-row check catches it, and this function bails out instead
// of silently clobbering whatever the other request just wrote. Returns
// false on any failure — a lost race or a real database error — so the
// caller can tell the user to retry instead of reporting success.
async function swapStepOrder(
  supabase: ServerSupabase,
  current: { id: number; step_order: number },
  neighbor: { id: number; step_order: number }
): Promise<boolean> {
  const { data: parked, error: parkError } = await supabase
    .from("workflow_steps")
    .update({ step_order: 0 })
    .eq("id", current.id)
    .eq("step_order", current.step_order)
    .select("id");

  if (parkError) {
    console.error("swapStepOrder: failed to park the current step:", parkError);
    return false;
  }
  if (!parked || parked.length === 0) {
    // Someone else already moved this step since it was read — abort
    // rather than guess what order it should end up in.
    return false;
  }

  const { data: moved, error: moveError } = await supabase
    .from("workflow_steps")
    .update({ step_order: current.step_order })
    .eq("id", neighbor.id)
    .eq("step_order", neighbor.step_order)
    .select("id");

  if (moveError || !moved || moved.length === 0) {
    if (moveError) {
      console.error("swapStepOrder: failed to move the neighbor step:", moveError);
    }
    // Best-effort rollback so the current step doesn't stay parked at the
    // impossible sentinel value if the rest of the swap can't complete.
    await supabase.from("workflow_steps").update({ step_order: current.step_order }).eq("id", current.id);
    return false;
  }

  // No step_order guard needed here: current.id is uniquely at sentinel 0
  // right now (the unique index guarantees only one row can hold it, and
  // only this call could have put current.id there), so nothing else could
  // plausibly have touched it between the two calls above.
  const { error: finalizeError } = await supabase
    .from("workflow_steps")
    .update({ step_order: neighbor.step_order })
    .eq("id", current.id);

  if (finalizeError) {
    console.error("swapStepOrder: failed to finalize the current step's new order:", finalizeError);
    return false;
  }

  return true;
}

// Deleting a step leaves a gap (e.g. steps 1,3,4 after removing 2) — this
// closes it back to a continuous 1..n, per the Builder specification §6.
// Iterates lowest-to-highest so every write lands on a step_order that was
// just vacated, never colliding with the unique index. Stops at the first
// failed write rather than pressing on — a partially-renumbered sequence
// is still a valid (if gappy) ordering, and continuing past a real
// database error risks writing steps out of the order the earlier ones
// already committed to.
async function renumberSteps(supabase: ServerSupabase, workflowId: number) {
  const { data: steps, error } = await supabase
    .from("workflow_steps")
    .select("id, step_order")
    .eq("workflow_id", workflowId)
    .order("step_order", { ascending: true });

  if (error || !steps) {
    console.error("renumberSteps: failed to load steps:", error);
    return;
  }

  for (let i = 0; i < steps.length; i++) {
    const desiredOrder = i + 1;
    if (steps[i].step_order !== desiredOrder) {
      const { error: updateError } = await supabase
        .from("workflow_steps")
        .update({ step_order: desiredOrder })
        .eq("id", steps[i].id);

      if (updateError) {
        console.error("renumberSteps: failed to renumber step", steps[i].id, updateError);
        return;
      }
    }
  }
}

// Editable at any time, including on an Active workflow — changes apply
// immediately, no "republish" step (Builder specification §4, a deliberate
// decision against a draft-of-changes system). Same non-empty-name /
// valid-trigger validation as createWorkflow, since both are "at every
// save" rules per the specification's validation table (§8).
export async function updateWorkflowDetails(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));
  const name = String(formData.get("name") ?? "").trim();
  const triggerEvent = String(formData.get("trigger_event") ?? "");

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }

  if (!name) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("The workflow name is required.")}`
    );
  }

  if (!isValidEventType(triggerEvent)) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Invalid trigger event.")}`
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("workflows")
    .update({ name, trigger_event: triggerEvent })
    .eq("id", workflowId);

  if (error) {
    console.error("updateWorkflowDetails failed:", error);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not update the workflow.")}`
    );
  }

  redirect(`/shops/${shopId}/workflows/${workflowId}`);
}

// The one Draft -> Active transition, and the only place the specification's
// strict validation rules (§8) apply: a Draft can be saved incomplete or
// empty, but activating it enforces name, trigger, at least one step, and
// every step's module actually being registered. RLS decides who can flip
// this row; it can never decide whether flipping it is a valid business
// operation, so those checks live here (specification §11's own point).
export async function activateWorkflow(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const workflow = await loadWorkflowWithSteps(supabase, workflowId);

  if (!workflow) {
    console.error("activateWorkflow: failed to load workflow");
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not load the workflow.")}`
    );
  }

  if (!workflow.name?.trim()) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("The workflow name is required.")}`
    );
  }

  if (!isValidEventType(workflow.trigger_event)) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Invalid trigger event.")}`
    );
  }

  if (workflow.steps.length === 0) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Add at least one step before activating this workflow.")}`
    );
  }

  const missingModule = workflow.steps.find((step) => !getAutomationModule(step.module_name));
  if (missingModule) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent(
        `Module "${missingModule.module_name}" is not available. Replace or remove this step.`
      )}`
    );
  }

  const { error } = await supabase
    .from("workflows")
    .update({
      is_active: true,
      // Stamped only the first time — see the activated_at column comment
      // in schema.sql. Purely a display refinement; the Workflow Manager
      // and Execution Engine never read this column.
      ...(workflow.activated_at ? {} : { activated_at: new Date().toISOString() }),
    })
    .eq("id", workflowId);

  if (error) {
    console.error("activateWorkflow failed:", error);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not activate the workflow.")}`
    );
  }

  logger.audit("workflow.activated", { shopId, workflowId, triggerEvent: workflow.trigger_event });
  redirect(`/shops/${shopId}/workflows/${workflowId}?activated=1`);
}

// Always allowed, no validation required — the specification is explicit
// that deactivation, unlike activation, is never blocked.
export async function deactivateWorkflow(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("workflows")
    .update({ is_active: false })
    .eq("id", workflowId);

  if (error) {
    console.error("deactivateWorkflow failed:", error);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not deactivate the workflow.")}`
    );
  }

  logger.audit("workflow.deactivated", { shopId, workflowId });
  redirect(`/shops/${shopId}/workflows/${workflowId}?deactivated=1`);
}

// Module existence is deliberately NOT checked here — per the validation
// table (§8), "each module_name exists in the registry" is an
// activation-time rule only, so a Draft can reference a module that
// doesn't exist yet without blocking the save. Only JSON syntax (generic,
// every module), size, and the module's own validateConfig() (if it
// happens to be registered) are checked at step-save time.
export async function addWorkflowStep(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));
  const moduleName = String(formData.get("module_name") ?? "");
  const configText = String(formData.get("config") ?? "").trim();

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }

  if (!moduleName) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Choose a module for the new step.")}`
    );
  }

  if (configText.length > MAX_STEP_CONFIG_LENGTH) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent(
        `The step configuration is too large (max ${MAX_STEP_CONFIG_LENGTH.toLocaleString()} characters).`
      )}`
    );
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(configText || "{}");
  } catch {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("The step configuration is not valid JSON.")}`
    );
  }

  const validationMessage = getAutomationModule(moduleName)?.validateConfig?.(config);
  if (validationMessage) {
    redirect(`/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent(validationMessage)}`);
  }

  const supabase = await createSupabaseServerClient();

  const { data: lastStep, error: lastStepError } = await supabase
    .from("workflow_steps")
    .select("step_order")
    .eq("workflow_id", workflowId)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastStepError) {
    console.error("addWorkflowStep: failed to load existing steps:", lastStepError);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not add the step.")}`
    );
  }

  const { error } = await supabase.from("workflow_steps").insert({
    workflow_id: workflowId,
    step_order: (lastStep?.step_order ?? 0) + 1,
    module_name: moduleName,
    config,
  });

  if (error) {
    console.error("addWorkflowStep failed:", error);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not add the step.")}`
    );
  }

  redirect(`/shops/${shopId}/workflows/${workflowId}`);
}

export async function updateWorkflowStep(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));
  const stepId = parsePositiveInt(formData.get("step_id"));
  const moduleName = String(formData.get("module_name") ?? "");
  const configText = String(formData.get("config") ?? "").trim();

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }
  if (stepId === null) {
    redirect(`/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Invalid step.")}`);
  }

  if (!moduleName) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Choose a module for this step.")}`
    );
  }

  if (configText.length > MAX_STEP_CONFIG_LENGTH) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent(
        `The step configuration is too large (max ${MAX_STEP_CONFIG_LENGTH.toLocaleString()} characters).`
      )}`
    );
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(configText || "{}");
  } catch {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("The step configuration is not valid JSON.")}`
    );
  }

  const validationMessage = getAutomationModule(moduleName)?.validateConfig?.(config);
  if (validationMessage) {
    redirect(`/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent(validationMessage)}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("workflow_steps")
    .update({ module_name: moduleName, config })
    .eq("id", stepId);

  if (error) {
    console.error("updateWorkflowStep failed:", error);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not update the step.")}`
    );
  }

  redirect(`/shops/${shopId}/workflows/${workflowId}`);
}

export async function removeWorkflowStep(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));
  const stepId = parsePositiveInt(formData.get("step_id"));

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }
  if (stepId === null) {
    redirect(`/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Invalid step.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("workflow_steps").delete().eq("id", stepId);

  if (error) {
    console.error("removeWorkflowStep failed:", error);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not remove the step.")}`
    );
  }

  await renumberSteps(supabase, workflowId);

  redirect(`/shops/${shopId}/workflows/${workflowId}`);
}

export async function moveWorkflowStepUp(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));
  const stepId = parsePositiveInt(formData.get("step_id"));

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }
  if (stepId === null) {
    redirect(`/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Invalid step.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: step, error: stepError } = await supabase
    .from("workflow_steps")
    .select("id, step_order")
    .eq("id", stepId)
    .single();

  if (stepError || !step) {
    console.error("moveWorkflowStepUp: failed to load step:", stepError);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not move the step.")}`
    );
  }

  const { data: neighbor } = await supabase
    .from("workflow_steps")
    .select("id, step_order")
    .eq("workflow_id", workflowId)
    .lt("step_order", step.step_order)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  // No neighbor above (already the first step) — a silent no-op, same as
  // the ↑ button simply being hidden on the first row.
  if (neighbor) {
    const moved = await swapStepOrder(supabase, step, neighbor);
    if (!moved) {
      redirect(
        `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent(
          "Could not move the step — it may have just been changed elsewhere. Please try again."
        )}`
      );
    }
  }

  redirect(`/shops/${shopId}/workflows/${workflowId}`);
}

export async function moveWorkflowStepDown(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));
  const stepId = parsePositiveInt(formData.get("step_id"));

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }
  if (stepId === null) {
    redirect(`/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Invalid step.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: step, error: stepError } = await supabase
    .from("workflow_steps")
    .select("id, step_order")
    .eq("id", stepId)
    .single();

  if (stepError || !step) {
    console.error("moveWorkflowStepDown: failed to load step:", stepError);
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not move the step.")}`
    );
  }

  const { data: neighbor } = await supabase
    .from("workflow_steps")
    .select("id, step_order")
    .eq("workflow_id", workflowId)
    .gt("step_order", step.step_order)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (neighbor) {
    const moved = await swapStepOrder(supabase, step, neighbor);
    if (!moved) {
      redirect(
        `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent(
          "Could not move the step — it may have just been changed elsewhere. Please try again."
        )}`
      );
    }
  }

  redirect(`/shops/${shopId}/workflows/${workflowId}`);
}

// "Test this workflow now" — an additional caller of the exact same
// runWorkflow() the Execution Engine calls in production, not a second
// execution path (specification §12), same relationship as Admin's "Run
// Synchronization Now" calling runSyncForShops(). Works on a Draft
// workflow (unlike real dispatch, which only ever resolves Active ones) so
// a merchant can verify a workflow before activating it. The result is
// written to workflow_executions by runWorkflow() itself, exactly like any
// other run — no separate test table.
export async function runWorkflowNow(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }
  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const workflow = await loadWorkflowWithSteps(supabase, workflowId);

  if (!workflow) {
    console.error("runWorkflowNow: failed to load workflow");
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("Could not load the workflow.")}`
    );
  }

  const { data: latestOrder, error: orderError } = await supabase
    .from("orders")
    .select("*, shops(name, platform)")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError || !latestOrder) {
    redirect(
      `/shops/${shopId}/workflows/${workflowId}?error=${encodeURIComponent("This shop has no orders yet to test against.")}`
    );
  }

  await runWorkflow(workflow, latestOrder as Order);

  redirect(`/shops/${shopId}/workflows/${workflowId}?tested=1`);
}
