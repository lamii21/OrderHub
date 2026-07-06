import { createSupabaseServerClient } from "@/lib/supabase-server";
import { StatCard } from "@/components/stat-card";
import { ProductsTable } from "@/components/products-table";
import { ErrorBanner } from "@/components/error-banner";
import type { Product } from "@/types/product";

export const revalidate = 0;

type ProductStats = {
  total_products: number | string;
  out_of_stock_products: number | string;
  best_selling_product: string | null;
};

export default async function ProductsPage() {
  // Queried as the logged-in user, so both RPCs are RLS-scoped to this
  // user's own shops/products/orders — no manual filter needed here.
  const supabase = await createSupabaseServerClient();

  const [productsResult, statsResult] = await Promise.all([
    supabase.rpc("get_products_with_stats"),
    supabase.rpc("get_product_stats"),
  ]);

  const { data: products, error: productsError } = productsResult;
  const { data: statsRows, error: statsError } = statsResult;

  if (productsError || statsError) {
    console.error("Products load failed:", productsError ?? statsError);
    return (
      <ErrorBanner message="We couldn't load your products right now. Please refresh the page in a moment." />
    );
  }

  const stats = (statsRows as ProductStats[])[0];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Products</h1>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Number of Products" value={Number(stats.total_products)} />
        <StatCard label="Out of Stock Products" value={Number(stats.out_of_stock_products)} />
        <StatCard label="Best Selling Product" value={stats.best_selling_product ?? "-"} />
      </div>

      <ProductsTable products={products as Product[]} />
    </main>
  );
}
