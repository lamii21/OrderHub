import { searchProductsByName } from "./repository";

// A bucket, not the raw number — same convention as the Phase 6 analysis
// this étape formalizes: never expose exact inventory counts to a
// customer-facing tool. "unknown" (not "in_stock") is the deliberate
// default for a null stock_quantity — a product that isn't inventory
// tracked shouldn't be reported as confidently available, and definitely
// not as out of stock.
export type AvailabilityStatus = "in_stock" | "low_stock" | "out_of_stock" | "unknown";

const LOW_STOCK_THRESHOLD = 5;

function toAvailability(stockQuantity: number | null): AvailabilityStatus {
  if (stockQuantity === null) {
    return "unknown";
  }
  if (stockQuantity <= 0) {
    return "out_of_stock";
  }
  if (stockQuantity <= LOW_STOCK_THRESHOLD) {
    return "low_stock";
  }
  return "in_stock";
}

export type ProductVariantForCustomer = {
  title: string | null;
  price: number | null;
  availability: AvailabilityStatus;
};

export type ProductForCustomer = {
  name: string;
  price: number | null;
  availability: AvailabilityStatus;
  variants: ProductVariantForCustomer[];
};

// Caps results at a small, fixed count — every product this returns gets
// serialized into the next prompt (token cost), and a long list is no more
// useful to a customer in a chat than a short one. A named constant, not a
// magic number, same posture as summary/trigger.ts's SUMMARY_TRIGGER_INTERVAL.
export const DEFAULT_SEARCH_RESULT_LIMIT = 5;

export async function searchProductsForCustomer(shopId: number, query: string): Promise<ProductForCustomer[]> {
  const rows = await searchProductsByName(shopId, query, DEFAULT_SEARCH_RESULT_LIMIT);

  return rows.map((row) => ({
    name: row.name,
    price: row.price,
    availability: toAvailability(row.stock_quantity),
    variants: (row.product_variants ?? []).map((variant) => ({
      title: variant.title,
      price: variant.price,
      availability: toAvailability(variant.stock_quantity),
    })),
  }));
}
