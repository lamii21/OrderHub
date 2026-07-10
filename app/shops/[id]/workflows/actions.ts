"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isValidEventType } from "@/lib/events/types";
import { parsePositiveInt } from "@/lib/validation";
import { logger } from "@/lib/logger";

// A workflow always starts life as a Draft (is_active defaults to false in
// schema.sql) — never active on creation, per the Workflow Builder
// specification's lifecycle table. Runs as the logged-in user: the "Users
// can insert their own workflows" RLS policy is what actually stops this
// from creating a workflow under a shop that isn't theirs.
export async function createWorkflow(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const name = String(formData.get("name") ?? "").trim();
  const triggerEvent = String(formData.get("trigger_event") ?? "");

  // Can't build a trustworthy /shops/${shopId}/... URL for the remaining
  // redirects without a valid shopId, so this one falls back to the shop
  // list rather than echoing the raw, possibly-malicious form value into a
  // Location header.
  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }

  if (!name) {
    redirect(
      `/shops/${shopId}/workflows/new?error=${encodeURIComponent("The workflow name is required.")}`
    );
  }

  if (!isValidEventType(triggerEvent)) {
    redirect(
      `/shops/${shopId}/workflows/new?error=${encodeURIComponent("Invalid trigger event.")}`
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workflows")
    .insert({ shop_id: shopId, name, trigger_event: triggerEvent })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createWorkflow failed:", error);
    redirect(
      `/shops/${shopId}/workflows/new?error=${encodeURIComponent("Could not create the workflow.")}`
    );
  }

  // Immediate redirect to the editor — the merchant never has to go look
  // for where to configure steps, per the Builder specification §1.
  redirect(`/shops/${shopId}/workflows/${data.id}`);
}

// Always allowed, at any lifecycle state — workflow_steps cascade-deletes
// automatically (on delete cascade, set from its first migration), so
// there's no step cleanup to do here. Same "delete for their own shops"
// RLS shape as deleteShop.
export async function deleteWorkflow(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const workflowId = parsePositiveInt(formData.get("workflow_id"));

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }

  if (workflowId === null) {
    redirect(`/shops/${shopId}/workflows?error=${encodeURIComponent("Invalid workflow.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("workflows").delete().eq("id", workflowId);

  if (error) {
    console.error("deleteWorkflow failed:", error);
    redirect(
      `/shops/${shopId}/workflows?error=${encodeURIComponent("Could not delete the workflow.")}`
    );
  }

  logger.audit("workflow.deleted", { shopId, workflowId });
  redirect(`/shops/${shopId}/workflows?deleted=1`);
}
