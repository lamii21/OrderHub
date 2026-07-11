import { supabase } from "@/lib/supabase";
import { getConnector, type PlatformCredentials } from "@/lib/platforms";
import { appendOrderRows } from "@/lib/google-sheets";
import { recordSyncHistory } from "@/lib/sync-history";
import { runWithConcurrency } from "@/lib/concurrency";

// The shape both callers of this file already have on hand: the manual
// Server Actions (app/shops/connect/actions.ts) fetch it via the
// ownership-checked getShopCredentials(), the cron endpoint
// (app/api/cron/sync/route.ts) fetches a whole batch of these directly.
// Neither passes a FormData or expects a redirect — that's exactly why this
// logic lives here instead of staying inline in the Server Actions: a route
// handler with no browser navigation can't call next/navigation's redirect().
export type ShopForSync = {
  id: number;
  platform: string;
  sheet_id: string | null;
  store_url: string | null;
  api_key: string | null;
  api_secret: string | null;
  last_synced_at: string | null;
};

export type SyncOutcome = { success: boolean; count: number };

export function toPlatformCredentials(shop: ShopForSync): PlatformCredentials {
  return {
    storeUrl: shop.store_url!,
    apiKey: shop.api_key!,
    ...(shop.api_secret !== null && { apiSecret: shop.api_secret }),
  };
}

// Stamped after every attempt, success or failure, by both sync functions
// below — see the comment on shops.last_sync_attempt_at in schema.sql for
// why this is a separate column from last_synced_at.
async function markAttempted(shopId: number) {
  await supabase
    .from("shops")
    .update({ last_sync_attempt_at: new Date().toISOString() })
    .eq("id", shopId);
}

export async function syncShopProducts(shop: ShopForSync): Promise<SyncOutcome> {
  const startedAt = new Date();

  try {
    const connector = getConnector(shop.platform);
    const products = await connector.fetchProducts(toPlatformCredentials(shop));

    const rows = products.map((product) => ({
      shop_id: shop.id,
      platform_product_id: product.platformProductId,
      name: product.name,
      sku: product.sku,
      description: product.description,
      price: product.price,
      stock_quantity: product.stockQuantity,
    }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("products")
        .upsert(rows, { onConflict: "shop_id,platform_product_id" });

      if (error) {
        throw error;
      }
    }

    await recordSyncHistory({
      shopId: shop.id,
      type: "products",
      startedAt,
      status: "success",
      importedCount: rows.length,
    });
    await markAttempted(shop.id);

    return { success: true, count: rows.length };
  } catch (err) {
    console.error(`syncShopProducts failed for shop ${shop.id}:`, err);
    // message is a fixed, user-safe string — never the caught error itself,
    // which could carry a raw platform/Postgres error message or stack trace.
    await recordSyncHistory({
      shopId: shop.id,
      type: "products",
      startedAt,
      status: "failed",
      message: "Could not sync products. Check the store URL and access token.",
    });
    await markAttempted(shop.id);

    return { success: false, count: 0 };
  }
}

export type SyncableShop = ShopForSync & {
  sync_products_enabled: boolean;
  sync_orders_enabled: boolean;
};

// Shops in flight at once — see lib/concurrency.ts's own comment for why
// this is bounded rather than sequential (a real cron-timeout incident) or
// unbounded (10 concurrent calls across 10 different merchants' own
// platform accounts is nothing like a stampede on one API; sequential was
// the one that actually caused an incident, not unbounded parallelism).
const SYNC_CONCURRENCY = 10;

// The one shared loop behind both /api/cron/sync (auto, filtered to
// due-and-enabled shops, and capped per run — see MAX_SHOPS_PER_RUN there)
// and /admin's "Run Synchronization Now" (manual, forced — every connected
// shop, ignoring the schedule, uncapped since an admin watching the page
// explicitly asked for all of them). Neither caller duplicates this logic;
// they only differ in which shops they pass in.
export async function runSyncForShops(
  shops: SyncableShop[]
): Promise<{ shopId: number; products: number; orders: number }[]> {
  const results: { shopId: number; products: number; orders: number }[] = [];

  await runWithConcurrency(shops, SYNC_CONCURRENCY, async (shop) => {
    try {
      const products = shop.sync_products_enabled
        ? await syncShopProducts(shop)
        : { success: true, count: 0 };
      const orders = shop.sync_orders_enabled
        ? await syncShopOrders(shop)
        : { success: true, count: 0 };
      results.push({ shopId: shop.id, products: products.count, orders: orders.count });
    } catch (err) {
      // syncShopProducts/syncShopOrders already catch their own failures and
      // record them in sync_history — this outer catch exists only so a
      // truly unexpected error can never abort the batch and skip whatever
      // else is still in flight or queued behind it.
      console.error(`runSyncForShops: unexpected error for shop ${shop.id}:`, err);
    }
  });

  return results;
}

export async function syncShopOrders(shop: ShopForSync): Promise<SyncOutcome> {
  const startedAt = new Date();

  try {
    const connector = getConnector(shop.platform);
    const orders = await connector.fetchOrders(toPlatformCredentials(shop), shop.last_synced_at);

    const rows = orders.flatMap((order) =>
      order.lines.map((line) => [
        line.customerName,
        line.customerPhone,
        line.customerCity,
        line.customerAddress,
        line.product,
        line.quantity,
        line.price,
      ])
    );

    if (rows.length > 0 && shop.sheet_id) {
      await appendOrderRows(shop.sheet_id, rows);
    }

    // Cursor = the newest createdAt the connector actually returned, not
    // wall-clock "now" — see app/shops/connect/actions.ts's original comment
    // for the full reasoning (unchanged by this refactor).
    const newestCreatedAt = orders.reduce<string | null>(
      (latest, order) => (!latest || order.createdAt > latest ? order.createdAt : latest),
      null
    );

    if (newestCreatedAt) {
      const nextCursor = new Date(new Date(newestCreatedAt).getTime() + 1000).toISOString();

      const { error } = await supabase
        .from("shops")
        .update({ last_synced_at: nextCursor })
        .eq("id", shop.id);

      if (error) {
        throw error;
      }
    }

    await recordSyncHistory({
      shopId: shop.id,
      type: "orders",
      startedAt,
      status: "success",
      importedCount: rows.length,
    });
    await markAttempted(shop.id);

    return { success: true, count: rows.length };
  } catch (err) {
    console.error(`syncShopOrders failed for shop ${shop.id}:`, err);
    await recordSyncHistory({
      shopId: shop.id,
      type: "orders",
      startedAt,
      status: "failed",
      message:
        "Could not sync orders to the Google Sheet. Check the store credentials and that the sheet still exists.",
    });
    await markAttempted(shop.id);

    return { success: false, count: 0 };
  }
}
