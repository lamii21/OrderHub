import { createSupabaseServerClient } from "@/lib/supabase-server";
import { StatCard } from "@/components/stat-card";
import { ErrorBanner } from "@/components/error-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrdersPerDayChart, type OrdersPerDayPoint } from "@/components/charts/orders-per-day-chart";
import { TopProductsChart, type TopProductPoint } from "@/components/charts/top-products-chart";
import { RevenueByCityChart, type RevenueByCityPoint } from "@/components/charts/revenue-by-city-chart";

export const revalidate = 0;

type DashboardStats = {
  total_orders: number | string;
  pending_orders: number | string;
  delivered_orders: number | string;
  total_revenue: number | string;
};

export default async function AnalyticsPage() {
  // Queried as the logged-in user: every RPC below is security-invoker, so
  // RLS on orders/products/shops scopes each aggregate to this user's own
  // shops automatically — no shop_id filter needed here.
  const supabase = await createSupabaseServerClient();

  const [statsResult, ordersPerDayResult, topProductsResult, revenueByCityResult] =
    await Promise.all([
      supabase.rpc("get_dashboard_stats"),
      supabase.rpc("get_orders_per_day"),
      supabase.rpc("get_top_products"),
      supabase.rpc("get_revenue_by_city"),
    ]);

  const error =
    statsResult.error ??
    ordersPerDayResult.error ??
    topProductsResult.error ??
    revenueByCityResult.error;

  if (error) {
    console.error("Analytics load failed:", error);
    return (
      <ErrorBanner message="We couldn't load your analytics right now. Please refresh the page in a moment." />
    );
  }

  const stats = (statsResult.data as DashboardStats[])[0];
  const ordersPerDay = ordersPerDayResult.data as OrdersPerDayPoint[];
  const topProducts = topProductsResult.data as TopProductPoint[];
  const revenueByCity = revenueByCityResult.data as RevenueByCityPoint[];

  const totalOrders = Number(stats.total_orders);
  const totalRevenue = Number(stats.total_revenue);
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Analytics</h1>

      {totalOrders === 0 ? (
        <div className="rounded-lg border bg-white p-10 text-center text-gray-500">
          No analytics yet. Once orders start coming in, KPIs and charts will show up here.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatCard label="Total Revenue" value={totalRevenue.toFixed(2)} />
            <StatCard label="Total Orders" value={totalOrders} />
            <StatCard label="Pending Orders" value={Number(stats.pending_orders)} />
            <StatCard label="Delivered Orders" value={Number(stats.delivered_orders)} />
            <StatCard label="Average Order Value" value={averageOrderValue.toFixed(2)} />
          </div>

          <div className="mb-6 rounded-lg border bg-white p-4">
            <h2 className="mb-2 text-lg font-semibold">Orders per Day</h2>
            {ordersPerDay.length === 0 ? (
              <p className="p-6 text-center text-gray-500">No order data yet.</p>
            ) : (
              <OrdersPerDayChart data={ordersPerDay} />
            )}
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border bg-white p-4">
              <h2 className="mb-2 text-lg font-semibold">Top 10 Best-Selling Products</h2>
              {topProducts.length === 0 ? (
                <p className="p-6 text-center text-gray-500">No product data yet.</p>
              ) : (
                <>
                  <TopProductsChart data={topProducts} />
                  <div className="mt-4 border-t pt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Quantity Sold</TableHead>
                          <TableHead>Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topProducts.map((row) => (
                          <TableRow key={row.product}>
                            <TableCell>{row.product}</TableCell>
                            <TableCell>{row.quantity_sold}</TableCell>
                            <TableCell>{Number(row.revenue).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>

            <div className="rounded-lg border bg-white p-4">
              <h2 className="mb-2 text-lg font-semibold">Revenue by City</h2>
              {revenueByCity.length === 0 ? (
                <p className="p-6 text-center text-gray-500">No city data yet.</p>
              ) : (
                <>
                  <RevenueByCityChart data={revenueByCity} />
                  <div className="mt-4 border-t pt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>City</TableHead>
                          <TableHead>Orders</TableHead>
                          <TableHead>Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {revenueByCity.map((row) => (
                          <TableRow key={row.city}>
                            <TableCell>{row.city}</TableCell>
                            <TableCell>{row.orders_count}</TableCell>
                            <TableCell>{Number(row.revenue).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
