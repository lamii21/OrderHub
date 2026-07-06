import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Order } from "@/types/order";
import { OrdersTable } from "@/components/orders-table";
import { StatCard } from "@/components/stat-card";
import { ErrorBanner } from "@/components/error-banner";

export const revalidate = 0;

type DashboardStats = {
  total_orders: number | string;
  pending_orders: number | string;
  delivered_orders: number | string;
  total_revenue: number | string;
};

export default async function DashboardPage() {
  // Queried as the logged-in user: RLS scopes both the orders row-select and
  // the get_dashboard_stats() aggregate to this user's own shops with no
  // manual filter needed here.
  const supabase = await createSupabaseServerClient();

  const [ordersResult, statsResult] = await Promise.all([
    supabase
      .from("orders")
      .select("*, shops(name, platform)")
      .order("created_at", { ascending: false })
      .returns<Order[]>(),
    supabase.rpc("get_dashboard_stats"),
  ]);

  const { data: orders, error: ordersError } = ordersResult;
  const { data: statsRows, error: statsError } = statsResult;

  if (ordersError || statsError) {
    console.error("Dashboard load failed:", ordersError ?? statsError);
    return (
      <ErrorBanner message="We couldn't load your orders right now. Please refresh the page in a moment." />
    );
  }

  const stats = (statsRows as DashboardStats[])[0];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Orders</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Orders" value={Number(stats.total_orders)} />
        <StatCard label="Pending Orders" value={Number(stats.pending_orders)} />
        <StatCard label="Delivered Orders" value={Number(stats.delivered_orders)} />
        <StatCard label="Total Revenue" value={Number(stats.total_revenue).toFixed(2)} />
      </div>

      <OrdersTable orders={orders} />
    </main>
  );
}
