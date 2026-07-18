"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { provisionShopSpreadsheetOrSkip } from "@/lib/google-sheets";
import { getConnector, SUPPORTED_PLATFORMS } from "@/lib/platforms";
import { createOrUpdateShop } from "@/lib/shop";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { syncShopProducts, syncShopOrders, toPlatformCredentials, type ShopForSync } from "@/lib/sync";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// testConnection/syncProducts/syncOrders below each trigger a real,
// server-initiated call to a third-party platform API — the app acting as
// a proxy an authenticated caller could otherwise hammer to abuse that
// third party's API quota, or to repeatedly probe a store_url with no
// per-shop cost of their own (see lib/net-guard.ts's SSRF guard for the
// destination side of that same concern). Rate limited by IP rather than
// by shop_id: keys the limit to the actual caller, and still applies even
// to a caller who's spraying different shop_ids from the same connection.
async function checkExternalCallRateLimit(): Promise<boolean> {
  const ip = getClientIp(await headers());
  const result = checkRateLimit(`platform-call:${ip}`, { max: 20, windowMs: 60_000 });

  if (!result.allowed) {
    logger.warn("shops_connect.rate_limited", { ip });
  }

  return result.allowed;
}

// Same connector.testConnection() call the manual "Test Connection" button
// (below) already makes — reused here so connectShop/reconnectShop can run
// it automatically right after saving credentials, instead of leaving a
// merchant to discover a typo'd token only when a later sync fails. Never
// throws: a network error or an unreachable store is a "failed" verification
// result, not a reason to fail the save that already succeeded.
async function verifyStoreConnection(
  platform: string,
  credentials: { storeUrl: string; apiKey: string; apiSecret?: string }
): Promise<boolean> {
  try {
    return await getConnector(platform).testConnection(credentials);
  } catch (err) {
    console.error("Automatic connection verification failed:", err);
    return false;
  }
}

export async function connectShop(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const platform = String(formData.get("platform") ?? "").trim();
  const storeUrl = String(formData.get("store_url") ?? "").trim();
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const apiSecret = String(formData.get("api_secret") ?? "").trim();

  if (!name || !platform || !storeUrl || !apiKey) {
    redirect(
      `/shops/connect?error=${encodeURIComponent(
        "Shop name, platform, store URL, and API key are all required."
      )}`
    );
  }

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    redirect(`/shops/connect?error=${encodeURIComponent("Unsupported platform.")}`);
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
    // Never blocks shop creation — see provisionShopSpreadsheetOrSkip's own
    // comment (lib/google-sheets.ts).
    const sheet = await provisionShopSpreadsheetOrSkip(user.id, name, platform);
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

  // Same "credential change is audit-worthy" precedent as
  // shop.webhook_secret_regenerated/shop.disconnected — this is the one
  // that actually stores a merchant's platform api_key/api_secret for the
  // first time.
  logger.audit("shop.connected", { shopId, platform });

  const connectionVerified = await verifyStoreConnection(platform, {
    storeUrl,
    apiKey,
    ...(apiSecret && { apiSecret }),
  });

  redirect(
    `/shops/connect?shop_id=${shopId}&connection_test=${connectionVerified ? "success" : "failed"}`
  );
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

  if (!(await checkExternalCallRateLimit())) {
    redirect(
      `${redirectTo}?shop_id=${shopId}&error=${encodeURIComponent("Too many requests. Please wait a moment and try again.")}`
    );
  }

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

  logger.audit("shop.reconnected", { shopId, platform });

  const connectionVerified = await verifyStoreConnection(platform, {
    storeUrl,
    apiKey,
    ...(apiSecret && { apiSecret }),
  });

  // Lands back in the same "shop_id" success branch /shops/connect/page.tsx
  // already renders after a fresh connectShop() — Test Connection/Sync
  // Products/Sync Orders action cards, plus the same automatic connection
  // banner, with no new UI needed for this path.
  redirect(
    `/shops/connect?shop_id=${shopId}&connection_test=${connectionVerified ? "success" : "failed"}`
  );
}

// This Server Action and the /api/cron/sync route handler are the only two
// callers of syncShopProducts() — same for syncOrders() below. Everything
// that actually talks to the platform API, writes products, or records
// sync_history lives once in lib/sync.ts; this function's only job is the
// form-specific part (authorize the submitted shop_id, then redirect).
export async function syncProducts(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const redirectTo = String(formData.get("redirect_to") ?? "/shops/connect");

  if (!(await checkExternalCallRateLimit())) {
    redirect(
      `${redirectTo}?shop_id=${shopId}&error=${encodeURIComponent("Too many requests. Please wait a moment and try again.")}`
    );
  }

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

  if (!(await checkExternalCallRateLimit())) {
    redirect(
      `${redirectTo}?shop_id=${shopId}&error=${encodeURIComponent("Too many requests. Please wait a moment and try again.")}`
    );
  }

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
