"use server";

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { provisionShopSpreadsheet } from "@/lib/google-sheets";
import { getConnector, SUPPORTED_PLATFORMS } from "@/lib/platforms";
import { isValidEmail } from "@/lib/validation";
import { createOrUpdateShop } from "@/lib/shop";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { syncShopProducts, syncShopOrders, toPlatformCredentials, type ShopForSync } from "@/lib/sync";

export async function connectShop(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const platform = String(formData.get("platform") ?? "").trim();
  const storeUrl = String(formData.get("store_url") ?? "").trim();
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const apiSecret = String(formData.get("api_secret") ?? "").trim();
  const ownerEmail = String(formData.get("owner_email") ?? "").trim();

  if (!name || !platform || !storeUrl || !apiKey || !ownerEmail) {
    redirect(
      `/shops/connect?error=${encodeURIComponent(
        "Shop name, platform, store URL, API key, and owner email are all required."
      )}`
    );
  }

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    redirect(`/shops/connect?error=${encodeURIComponent("Unsupported platform.")}`);
  }

  if (!isValidEmail(ownerEmail)) {
    redirect(
      `/shops/connect?error=${encodeURIComponent("Please enter a valid Google account email.")}`
    );
  }

  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let shopId: number;

  try {
    const sheet = await provisionShopSpreadsheet(name, platform, ownerEmail);
    const shop = await createOrUpdateShop({
      name,
      platform,
      sheetId: sheet.id,
      sheetName: sheet.name,
      userId: user.id,
      storeUrl,
      apiKey,
      ...(apiSecret && { apiSecret }),
    });
    shopId = shop.id;
  } catch (err) {
    console.error("Failed to create shop:", err);
    redirect(
      `/shops/connect?error=${encodeURIComponent(
        "Could not create the shop. Please check the Google integration is configured correctly and try again."
      )}`
    );
  }

  redirect(`/shops/connect?shop_id=${shopId}`);
}

// Fetching the shop's credentials stays on the service-role client (per the
// "keep service role for platform sync" architecture), but the ownership
// check below is what stops one logged-in user from triggering a sync
// against a shop_id that isn't theirs just by submitting a different number.
//
async function getShopCredentials(shopId: string): Promise<ShopForSync | null> {
  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: shop, error } = await supabase
    .from("shops")
    .select("id, user_id, platform, sheet_id, store_url, api_key, api_secret, last_synced_at")
    .eq("id", shopId)
    .single();

  if (error || !shop || shop.user_id !== user.id || !shop.store_url || !shop.api_key) {
    return null;
  }

  return shop;
}

// Unchanged implementation — only the redirect target is now configurable,
// the same "redirect_to" convention syncProducts/syncOrders below already
// use. This is what lets /shops and /shops/[id] trigger the exact same
// Test Connection instead of a second copy of it.
export async function testConnection(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const redirectTo = String(formData.get("redirect_to") ?? "/shops/connect");
  const shop = await getShopCredentials(shopId);

  if (!shop) {
    redirect(`${redirectTo}?shop_id=${shopId}&error=${encodeURIComponent("Shop not found.")}`);
  }

  const connector = getConnector(shop.platform);
  const ok = await connector.testConnection(toPlatformCredentials(shop));

  redirect(`${redirectTo}?shop_id=${shopId}&test=${ok ? "success" : "failed"}`);
}

// Reconnecting an existing (disconnected) shop is deliberately NOT
// connectShop() called again: connectShop's whole job includes provisioning
// a brand-new Google Sheet, which would be wrong here — this shop already
// has one. Reconnecting only needs to refill the 3 credential columns
// disconnectStore() nulled out, so a direct update via the user-scoped
// client is enough — same RLS policy, same pattern as updateShopName.
export async function reconnectShop(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const platform = String(formData.get("platform") ?? "").trim();
  const storeUrl = String(formData.get("store_url") ?? "").trim();
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const apiSecret = String(formData.get("api_secret") ?? "").trim();

  if (!platform || !storeUrl || !apiKey) {
    redirect(
      `/shops/connect?reconnect=${shopId}&error=${encodeURIComponent(
        "Platform, store URL, and API key are required."
      )}`
    );
  }

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    redirect(`/shops/connect?reconnect=${shopId}&error=${encodeURIComponent("Unsupported platform.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("shops")
    .update({
      platform,
      store_url: storeUrl,
      api_key: apiKey,
      api_secret: apiSecret || null,
      credentials_changed_at: new Date().toISOString(),
    })
    .eq("id", shopId);

  if (error) {
    console.error("reconnectShop failed:", error);
    redirect(
      `/shops/connect?reconnect=${shopId}&error=${encodeURIComponent("Could not reconnect the store.")}`
    );
  }

  // Lands back in the same "shop_id" success branch /shops/connect/page.tsx
  // already renders after a fresh connectShop() — Test Connection/Sync
  // Products/Sync Orders action cards, with no new UI needed for this path.
  redirect(`/shops/connect?shop_id=${shopId}`);
}

// This Server Action and the /api/cron/sync route handler are the only two
// callers of syncShopProducts() — same for syncOrders() below. Everything
// that actually talks to the platform API, writes products, or records
// sync_history lives once in lib/sync.ts; this function's only job is the
// form-specific part (authorize the submitted shop_id, then redirect).
export async function syncProducts(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const redirectTo = String(formData.get("redirect_to") ?? "/shops/connect");
  const shop = await getShopCredentials(shopId);

  if (!shop) {
    redirect(`${redirectTo}?shop_id=${shopId}&error=${encodeURIComponent("Shop not found.")}`);
  }

  const result = await syncShopProducts(shop);

  if (!result.success) {
    redirect(
      `${redirectTo}?shop_id=${shopId}&error=${encodeURIComponent(
        "Could not sync products. Check the store URL and access token, then try again."
      )}`
    );
  }

  redirect(`${redirectTo}?shop_id=${shopId}&products_synced=${result.count}`);
}

export async function syncOrders(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const redirectTo = String(formData.get("redirect_to") ?? "/shops/connect");
  const shop = await getShopCredentials(shopId);

  if (!shop) {
    redirect(`${redirectTo}?shop_id=${shopId}&error=${encodeURIComponent("Shop not found.")}`);
  }

  const result = await syncShopOrders(shop);

  if (!result.success) {
    redirect(
      `${redirectTo}?shop_id=${shopId}&error=${encodeURIComponent(
        "Could not sync orders to the Google Sheet. Check the store credentials and that the sheet still exists, then try again."
      )}`
    );
  }

  redirect(`${redirectTo}?shop_id=${shopId}&orders_synced=${result.count}`);
}
