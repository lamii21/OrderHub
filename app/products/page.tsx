import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { StatCard } from "@/components/stat-card";
import { ProductsTable } from "@/components/products-table";
import { ErrorBanner } from "@/components/error-banner";
import { Icon } from "@/components/ui/icon";
import { ICONS } from "@/components/icons";
import type { Product } from "@/types/product";

export const revalidate = 0;

// Same page size and pattern as the Dashboard's orders list — products can
// scale into the thousands per synced shop, unlike /shops (RLS-scoped to
// one user's own shops, realistically never large enough to need this).
const PAGE_SIZE = 25;

type ProductStats = {
  total_products: number | string;
  out_of_stock_products: number | string;
  best_selling_product: string | null;
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const requestedPage = Number(sp.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Queried as the logged-in user, so both RPCs are RLS-scoped to this
  // user's own shops/products/orders — no manual filter needed here.
  const supabase = await createSupabaseServerClient();

  const [productsResult, statsResult] = await Promise.all([
    // get_products_with_stats() returns a set of rows (not a single value),
    // so PostgREST treats it as a paginable collection the same as a plain
    // table select — .range() + count: "exact" work here exactly as they do
    // on the Dashboard's supabase.from("orders") query.
    supabase.rpc("get_products_with_stats", {}, { count: "exact" }).range(from, to),
    supabase.rpc("get_product_stats"),
  ]);

  const { data: products, count: totalProducts, error: productsError } = productsResult;
  const { data: statsRows, error: statsError } = statsResult;

  if (productsError || statsError) {
    console.error("Products load failed:", productsError ?? statsError);
    return (
      <ErrorBanner message="We couldn't load your products right now. Please refresh the page in a moment." />
    );
  }

  // Same defensive default as the Dashboard/Analytics pages — get_product_stats()
  // should always return exactly one aggregate row, but this avoids a hard
  // crash (no per-route error boundary exists) if that were ever violated.
  const stats = (statsRows as ProductStats[])[0] ?? {
    total_products: 0,
    out_of_stock_products: 0,
    best_selling_product: null,
  };

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">Products</h1>
        <p className="mt-1 text-sm text-neutral-500">Catalog, stock, and sales performance.</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Number of Products"
          value={Number(stats.total_products)}
          tone="brand"
          icon={<Icon path={ICONS.products} className="h-4.5 w-4.5" />}
        />
        <StatCard
          label="Out of Stock Products"
          value={Number(stats.out_of_stock_products)}
          tone={Number(stats.out_of_stock_products) > 0 ? "danger" : "success"}
          icon={<Icon path={ICONS.box} className="h-4.5 w-4.5" />}
        />
        <StatCard
          label="Best Selling Product"
          value={stats.best_selling_product ?? "—"}
          tone="success"
          icon={<Icon path={ICONS.bolt} className="h-4.5 w-4.5" />}
        />
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        <ProductsTable products={products as Product[]} />
      </div>

      {(totalProducts ?? 0) > PAGE_SIZE && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-neutral-500">
            Page {page} of {Math.max(1, Math.ceil((totalProducts ?? 0) / PAGE_SIZE))} ·{" "}
            {totalProducts} products
          </span>
          <div className="flex gap-3">
            {page > 1 ? (
              <Link href={`/products?page=${page - 1}`} className="font-medium text-brand-600 hover:text-brand-700">
                ← Previous
              </Link>
            ) : (
              <span className="text-neutral-300">← Previous</span>
            )}
            {to + 1 < (totalProducts ?? 0) ? (
              <Link href={`/products?page=${page + 1}`} className="font-medium text-brand-600 hover:text-brand-700">
                Next →
              </Link>
            ) : (
              <span className="text-neutral-300">Next →</span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
