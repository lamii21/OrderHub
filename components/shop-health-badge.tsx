import { computeShopHealth, SHOP_HEALTH_LABELS } from "@/lib/shop-health";

export function ShopHealthBadge({
  shop,
}: {
  shop: { store_url: string | null; last_sync_status: "success" | "failed" | null };
}) {
  const health = computeShopHealth(shop);
  const { emoji, label } = SHOP_HEALTH_LABELS[health];

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span aria-hidden="true">{emoji}</span>
      {label}
    </span>
  );
}
