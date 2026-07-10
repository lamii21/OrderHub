// A shop's health badge is computed from data already loaded with the page
// (get_shops_with_stats()) — it never calls the connector's testConnection()
// live for every shop on every page view, which would mean hitting Shopify/
// WooCommerce/YouCan's API on every single admin page load. "Connected"
// here means "nothing on record says otherwise": credentials are present
// and the most recent sync attempt (if any) succeeded. Clicking the actual
// "Test Connection" button still calls the real connector, live, on demand
// — this badge is the resting state between those checks, not a replacement
// for them.
export type ShopHealth = "connected" | "needs_attention" | "disconnected";

type ShopForHealth = {
  store_url: string | null;
  last_sync_status: "success" | "failed" | null;
};

export function computeShopHealth(shop: ShopForHealth): ShopHealth {
  if (!shop.store_url) return "disconnected";
  if (shop.last_sync_status === "failed") return "needs_attention";
  return "connected";
}

export const SHOP_HEALTH_LABELS: Record<ShopHealth, { emoji: string; label: string }> = {
  connected: { emoji: "🟢", label: "Connected" },
  needs_attention: { emoji: "🟡", label: "Needs Attention" },
  disconnected: { emoji: "🔴", label: "Disconnected" },
};
