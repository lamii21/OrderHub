"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isValidSyncFrequency } from "@/lib/sync-schedule";
import { parsePositiveInt } from "@/lib/validation";
import { logger } from "@/lib/logger";

// Hard delete. orders/products still have to be deleted explicitly, in this
// order, before shops — that part hasn't changed. What *has* changed:
// sync_history/workflows/module_credentials (which reference shops.id) and
// order_history/workflow_executions (which reference orders.id) now cascade
// (see supabase/schema.sql, "Final review fixes") instead of blocking this
// delete with a foreign key violation, which is what used to happen for any
// shop that had ever synced or had a workflow configured. Runs as the
// logged-in user: the "delete ... for their own shops" RLS policies are
// what actually stop this from deleting anything that isn't theirs, so
// there's no manual ownership check to write here.
export async function deleteShop(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }

  const supabase = await createSupabaseServerClient();

  const { error: ordersError } = await supabase.from("orders").delete().eq("shop_id", shopId);
  if (ordersError) {
    console.error("deleteShop: failed to delete orders:", ordersError);
    redirect(`/shops?error=${encodeURIComponent("Could not delete the shop's orders.")}`);
  }

  const { error: productsError } = await supabase.from("products").delete().eq("shop_id", shopId);
  if (productsError) {
    console.error("deleteShop: failed to delete products:", productsError);
    redirect(`/shops?error=${encodeURIComponent("Could not delete the shop's products.")}`);
  }

  const { error: shopError } = await supabase.from("shops").delete().eq("id", shopId);
  if (shopError) {
    console.error("deleteShop: failed to delete shop:", shopError);
    redirect(`/shops?error=${encodeURIComponent("Could not delete the shop.")}`);
  }

  logger.audit("shop.deleted", { shopId });
  redirect("/shops?deleted=1");
}

// The only editable field per the brief. Reuses the existing "Users can
// update their own shops" RLS policy — no new policy needed, and no separate
// ownership check, for the same reason as above.
export async function updateShopName(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const name = String(formData.get("name") ?? "").trim();

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }

  if (!name) {
    redirect(`/shops/${shopId}?error=${encodeURIComponent("Shop name cannot be empty.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("shops").update({ name }).eq("id", shopId);

  if (error) {
    console.error("updateShopName failed:", error);
    redirect(`/shops/${shopId}?error=${encodeURIComponent("Could not update the shop name.")}`);
  }

  redirect(`/shops/${shopId}`);
}

// Nulling the 3 credential columns is the entire feature: the cron endpoint
// already filters shops to store_url/api_key not null, so a disconnected
// shop is automatically excluded from automatic sync with no separate
// "is_active" flag or extra check anywhere. Orders/products/sync_history/
// order_history are untouched — nothing here deletes anything. Same RLS
// policy as updateShopName/updateSyncFrequency, no manual ownership check.
export async function disconnectStore(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("shops")
    .update({
      store_url: null,
      api_key: null,
      api_secret: null,
      credentials_changed_at: new Date().toISOString(),
    })
    .eq("id", shopId);

  if (error) {
    console.error("disconnectStore failed:", error);
    redirect(`/shops/${shopId}?error=${encodeURIComponent("Could not disconnect the store.")}`);
  }

  logger.audit("shop.disconnected", { shopId });
  redirect(`/shops/${shopId}?disconnected=1`);
}

// Reuses the same "Users can update their own shops" RLS policy as
// updateShopName above — no new policy needed, since sync_frequency is just
// another column on the same row that policy already governs.
export async function updateSyncFrequency(formData: FormData) {
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const frequency = String(formData.get("sync_frequency") ?? "");

  if (shopId === null) {
    redirect(`/shops?error=${encodeURIComponent("Invalid shop.")}`);
  }

  if (!isValidSyncFrequency(frequency)) {
    redirect(`/shops/${shopId}?error=${encodeURIComponent("Invalid sync frequency.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("shops")
    .update({ sync_frequency: frequency })
    .eq("id", shopId);

  if (error) {
    console.error("updateSyncFrequency failed:", error);
    redirect(`/shops/${shopId}?error=${encodeURIComponent("Could not update sync frequency.")}`);
  }

  redirect(`/shops/${shopId}`);
}
