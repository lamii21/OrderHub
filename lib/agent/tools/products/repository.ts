import { supabase } from "@/lib/supabase";
import { escapeLikePattern } from "../shared";

// Pure Supabase I/O — no decisions here, same rule as
// lib/agent/tools/orders/repository.ts. Scoped by shop_id only (product
// search is shop-wide, not customer-specific — unlike orders, nothing here
// needs a customer_id).
//
// Column list deliberately excludes id, sku, and platform-specific
// identifiers (shopify_product_id, platform_variant_id) — a customer-facing
// tool has no use for a raw Supabase primary key or an internal SKU, and
// exposing a platform id would leak which e-commerce platform the shop
// runs on for no customer benefit. product_variants(...) relies on the
// product_id -> products(id) foreign key (supabase/schema.sql) for
// PostgREST to resolve the nested relationship automatically.
const PRODUCT_COLUMNS = "name, price, stock_quantity, product_variants(title, price, stock_quantity)";

export type ProductVariantRow = {
  title: string | null;
  price: number | null;
  stock_quantity: number | null;
};

export type ProductRow = {
  name: string;
  price: number | null;
  stock_quantity: number | null;
  product_variants: ProductVariantRow[];
};

export async function searchProductsByName(shopId: number, query: string, limit: number): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("shop_id", shopId)
    .ilike("name", `%${escapeLikePattern(query)}%`)
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ProductRow[];
}
