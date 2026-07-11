"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { provisionShopSpreadsheet } from "@/lib/google-sheets";
import { isValidEmail } from "@/lib/validation";
import { isValidSyncFrequency } from "@/lib/sync-schedule";
import { logger } from "@/lib/logger";

// All 3 settings actions below share one pattern with updateShopName/
// updateSyncFrequency/disconnectStore (app/shops/actions.ts): the
// user-scoped client plus the existing "Users can update their own shops"
// RLS policy, no manual ownership check. That policy is row-level, not
// column-level, so it already covers every column added for this feature —
// no new policy was needed.

export async function updateShopSettings(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const storeUrl = String(formData.get("store_url") ?? "").trim();
  const syncFrequency = String(formData.get("sync_frequency") ?? "");
  const currency = String(formData.get("currency") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();

  if (!name) {
    redirect(`/shops/${shopId}/settings?error=${encodeURIComponent("Shop name cannot be empty.")}`);
  }

  if (!isValidSyncFrequency(syncFrequency)) {
    redirect(`/shops/${shopId}/settings?error=${encodeURIComponent("Invalid sync frequency.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("shops")
    .update({
      name,
      // Empty means "clear it" — a Sheets-only shop has no store URL at
      // all, and that's a valid state, not an error.
      store_url: storeUrl || null,
      sync_frequency: syncFrequency,
      currency: currency || "USD",
      timezone: timezone || "UTC",
    })
    .eq("id", shopId);

  if (error) {
    console.error("updateShopSettings failed:", error);
    redirect(`/shops/${shopId}/settings?error=${encodeURIComponent("Could not save settings.")}`);
  }

  redirect(`/shops/${shopId}/settings?saved=1`);
}

// Checkboxes are absent from FormData entirely when unchecked — there is no
// "false" value to read, only "present" or "not present".
export async function updateNotificationSettings(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("shops")
    .update({
      sync_products_enabled: formData.get("sync_products_enabled") === "on",
      sync_orders_enabled: formData.get("sync_orders_enabled") === "on",
      auto_sync_enabled: formData.get("auto_sync_enabled") === "on",
      email_notifications_enabled: formData.get("email_notifications_enabled") === "on",
    })
    .eq("id", shopId);

  if (error) {
    console.error("updateNotificationSettings failed:", error);
    redirect(
      `/shops/${shopId}/settings?error=${encodeURIComponent("Could not save notification settings.")}`
    );
  }

  redirect(`/shops/${shopId}/settings?saved=1`);
}

// Reuses provisionShopSpreadsheet() exactly as connectShop()/createShop()
// already do (app/shops/connect/actions.ts, app/shops/new/actions.ts) — the
// only new part is pointing this EXISTING shop row at the freshly
// provisioned spreadsheet instead of inserting a new shop. The old
// spreadsheet is left alone in Drive; only the shop's sheet_id/sheet_name
// pointer moves.
export async function regenerateSpreadsheet(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const ownerEmail = String(formData.get("owner_email") ?? "").trim();

  if (!isValidEmail(ownerEmail)) {
    redirect(
      `/shops/${shopId}/settings?error=${encodeURIComponent(
        "Please enter a valid Google account email to share the new spreadsheet with."
      )}`
    );
  }

  const supabase = await createSupabaseServerClient();

  // RLS's "Users can view their own shops" policy already means this comes
  // back empty for a shop_id that isn't the caller's own.
  const { data: shop, error: fetchError } = await supabase
    .from("shops")
    .select("name, platform")
    .eq("id", shopId)
    .single();

  if (fetchError || !shop) {
    redirect(`/shops/${shopId}/settings?error=${encodeURIComponent("Shop not found.")}`);
  }

  try {
    const sheet = await provisionShopSpreadsheet(shop.name, shop.platform, ownerEmail);
    const { error } = await supabase
      .from("shops")
      .update({
        sheet_id: sheet.id,
        sheet_name: sheet.name,
        sheet_regenerated_at: new Date().toISOString(),
      })
      .eq("id", shopId);

    if (error) {
      throw error;
    }
  } catch (err) {
    console.error("regenerateSpreadsheet failed:", err);
    redirect(
      `/shops/${shopId}/settings?error=${encodeURIComponent(
        "Could not regenerate the spreadsheet. Check the Google integration and try again."
      )}`
    );
  }

  logger.audit("shop.spreadsheet_regenerated", { shopId });
  redirect(`/shops/${shopId}/settings?regenerated=1`);
}

// schema.sql generates every shop's initial webhook_secret automatically
// (a column default, backfilled for existing shops too) — this is only for
// a merchant who suspects theirs has leaked and wants a fresh one without
// waiting on support. 32 random bytes as hex (64 chars), same shape as the
// database's own gen_random_uuid()-based default and generated the same
// way lib/env.ts already uses Node's crypto module, so a rotated secret is
// exactly as strong as an original one. The old value stops working the
// instant this commits — any Apps Script deployment still sending it will
// start getting 401s (falling through to the global API_SECRET check,
// same as any other unrecognized key) until it's updated with the new one
// shown on this page.
export async function regenerateWebhookSecret(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const newSecret = randomBytes(32).toString("hex");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("shops")
    .update({ webhook_secret: newSecret })
    .eq("id", shopId);

  if (error) {
    console.error("regenerateWebhookSecret failed:", error);
    redirect(
      `/shops/${shopId}/settings?error=${encodeURIComponent("Could not regenerate the webhook secret.")}`
    );
  }

  logger.audit("shop.webhook_secret_regenerated", { shopId });
  redirect(`/shops/${shopId}/settings?secret_regenerated=1`);
}
