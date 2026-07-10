import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Order } from "@/types/order";
import type { SyncHistoryWithShop } from "@/types/sync-history";
import type { OrderAutomationStatus } from "@/components/workflow-status-badge";
import { OrdersTable } from "@/components/orders-table";
import { StatCard } from "@/components/stat-card";
import { ErrorBanner } from "@/components/error-banner";
import { formatRelativeTime } from "@/lib/utils";

export const revalidate = 0;

// Same page size as the Admin Center's list-style sections (Recent Activity
// etc. cap at 15/30) — this dashboard is the one list that had no cap at
// all, so it's the one place that actually needed pagination controls
// rather than just a fixed limit.
const PAGE_SIZE = 25;

type DashboardStats = {
  total_orders: number | string;
  pending_orders: number | string;
  delivered_orders: number | string;
  total_revenue: number | string;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const requestedPage = Number(sp.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Queried as the logged-in user: RLS scopes the orders row-select, the
  // get_dashboard_stats() aggregate, and the sync_history lookup to this
  // user's own shops with no manual filter needed here.
  const supabase = await createSupabaseServerClient();

  const [ordersResult, statsResult, latestSyncResult] = await Promise.all([
    supabase
      .from("orders")
      .select("*, shops(name, platform)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<Order[]>(),
    supabase.rpc("get_dashboard_stats"),
    supabase
      .from("sync_history")
      .select("*, shops(name)")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: orders, count: totalOrders, error: ordersError } = ordersResult;
  const { data: statsRows, error: statsError } = statsResult;
  const { data: latestSync, error: syncError } = latestSyncResult;
  const sync = latestSync as SyncHistoryWithShop | null;

  if (ordersError || statsError) {
    console.error("Dashboard load failed:", ordersError ?? statsError);
    return (
      <ErrorBanner message="We couldn't load your orders right now. Please refresh the page in a moment." />
    );
  }

  if (syncError) {
    console.error("Latest sync load failed:", syncError);
  }

  const stats = (statsRows as DashboardStats[])[0];

  // A second, dependent fetch (needs this page's own order ids) — same
  // "secondary section, own failure doesn't block the rest of the page"
  // rule as latestSync above. One query for every order on this page,
  // not one per row: workflow_executions can have several rows per order
  // (one per step, across possibly several workflows), so the latest
  // status per order is reduced client-side, same in-memory-merge idiom
  // already used for /admin's Recent Activity.
  const orderIds = (orders ?? []).map((o) => o.id);
  const workflowStatusByOrderId = new Map<number, OrderAutomationStatus>();

  if (orderIds.length > 0) {
    const { data: executions, error: executionsError } = await supabase
      .from("workflow_executions")
      .select("order_id, status, started_at")
      .in("order_id", orderIds)
      .order("started_at", { ascending: false });

    if (executionsError) {
      console.error("Dashboard workflow status load failed:", executionsError);
    } else {
      for (const execution of executions ?? []) {
        // Already sorted newest-first, so the first row seen per order_id
        // is that order's latest — later rows for the same order are
        // skipped, not overwritten.
        if (!workflowStatusByOrderId.has(execution.order_id)) {
          workflowStatusByOrderId.set(execution.order_id, execution.status);
        }
      }
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Orders</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Total Orders" value={Number(stats.total_orders)} />
        <StatCard label="Pending Orders" value={Number(stats.pending_orders)} />
        <StatCard label="Delivered Orders" value={Number(stats.delivered_orders)} />
        <StatCard label="Total Revenue" value={Number(stats.total_revenue).toFixed(2)} />
        <StatCard
          label="Latest Synchronization"
          value={
            sync ? (
              <div className="space-y-0.5 text-sm font-normal">
                <p className="font-semibold text-gray-900">
                  {sync.shops?.name ?? "Unknown shop"} ·{" "}
                  {sync.type === "products" ? "Products" : "Orders"}
                </p>
                <p
                  className={
                    sync.status === "success"
                      ? "font-medium text-green-700"
                      : "font-medium text-red-700"
                  }
                >
                  {sync.status === "success" ? "Success" : "Failed"}
                </p>
                <p className="text-xs text-gray-500">
                  {formatRelativeTime(new Date(sync.started_at))}
                </p>
              </div>
            ) : (
              <span className="text-base font-normal text-gray-400">No syncs yet</span>
            )
          }
        />
      </div>

      <OrdersTable orders={orders} workflowStatusByOrderId={workflowStatusByOrderId} />

      {(totalOrders ?? 0) > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Page {page} of {Math.max(1, Math.ceil((totalOrders ?? 0) / PAGE_SIZE))} ·{" "}
            {totalOrders} orders
          </span>
          <div className="flex gap-3">
            {page > 1 ? (
              <Link href={`/dashboard?page=${page - 1}`} className="text-blue-600 hover:underline">
                ← Previous
              </Link>
            ) : (
              <span className="text-gray-300">← Previous</span>
            )}
            {to + 1 < (totalOrders ?? 0) ? (
              <Link href={`/dashboard?page=${page + 1}`} className="text-blue-600 hover:underline">
                Next →
              </Link>
            ) : (
              <span className="text-gray-300">Next →</span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
