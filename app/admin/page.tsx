import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ErrorBanner } from "@/components/error-banner";
import { StatCard } from "@/components/stat-card";
import { SubmitButton } from "@/components/submit-button";
import { SystemHealthBadge } from "@/components/system-health-badge";
import { OrdersPerDayChart } from "@/components/charts/orders-per-day-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import { computeNextSyncAt } from "@/lib/sync-schedule";
import {
  computeDatabaseHealth,
  computeGoogleSheetsHealth,
  computeCronHealth,
  computePlatformConnectorsHealth,
  computeWorkflowHealth,
} from "@/lib/system-health";
import {
  runSyncNow,
  refreshDashboard,
  testAllConnections,
  retryFailedWorkflowExecutions,
} from "./actions";
import type { ShopWithStats } from "@/types/shop";
import type { WorkflowWithStats } from "@/types/workflow";

export const revalidate = 0;

type SearchParams = {
  synced?: string;
  tested?: string;
  tests_passed?: string;
  tests_failed?: string;
  workflow_retried?: string;
  error?: string;
  error_filter?: string;
  workflow_error_filter?: string;
};

type ActivityItem = { id: string; timestamp: string; description: string };

const ERROR_FILTERS = ["today", "week", "month"] as const;
type ErrorFilter = (typeof ERROR_FILTERS)[number];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const errorFilter: ErrorFilter = ERROR_FILTERS.includes(sp.error_filter as ErrorFilter)
    ? (sp.error_filter as ErrorFilter)
    : "today";
  const workflowErrorFilter: ErrorFilter = ERROR_FILTERS.includes(
    sp.workflow_error_filter as ErrorFilter
  )
    ? (sp.workflow_error_filter as ErrorFilter)
    : "today";

  // Queried as the logged-in user throughout: RLS scopes every query below
  // (the RPCs and the plain table selects alike) to this user's own shops,
  // exactly like every other page in this app — /admin has no cross-user
  // "super admin" view, it's an operations center over the caller's own
  // connected stores.
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (todayStart.getUTCDay() + 6) % 7;
  const weekStart = new Date(todayStart);
  weekStart.setUTCDate(todayStart.getUTCDate() - daysSinceMonday);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const todayStr = todayStart.toISOString().slice(0, 10);
  const monthPrefix = todayStr.slice(0, 7);

  const errorFilterStart = {
    today: todayStart,
    week: weekStart,
    month: monthStart,
  }[errorFilter];
  const workflowErrorFilterStart = {
    today: todayStart,
    week: weekStart,
    month: monthStart,
  }[workflowErrorFilter];

  const [
    { data: user },
    shopsResult,
    ordersPerDayResult,
    productStatsResult,
    performanceResult,
    syncsTodayResult,
    failedSyncsTodayResult,
    errorCenterResult,
    recentOrdersResult,
    recentStatusChangesResult,
    recentSyncsResult,
    shopsExtraResult,
    recentOrderSyncsResult,
    workflowsStatsResult,
    workflowPerformanceResult,
    executionsTodayResult,
    failedExecutionsTodayResult,
    recentWorkflowExecutionsResult,
    failedWorkflowExecutionsResult,
    recentExecutionStatusesResult,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_shops_with_stats"),
    supabase.rpc("get_orders_per_day"),
    supabase.rpc("get_product_stats"),
    supabase.rpc("get_sync_performance_stats"),
    supabase
      .from("sync_history")
      .select("*", { count: "exact", head: true })
      .gte("started_at", todayStart.toISOString()),
    supabase
      .from("sync_history")
      .select("*", { count: "exact", head: true })
      .gte("started_at", todayStart.toISOString())
      .eq("status", "failed"),
    // No .limit() here — Error Center is explicitly "no pagination", scoped
    // instead by the Today/This Week/This Month filter below.
    supabase
      .from("sync_history")
      .select("id, type, started_at, message, shops(name, platform)")
      .eq("status", "failed")
      .gte("started_at", errorFilterStart.toISOString())
      .order("started_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id, customer_name, product, created_at, shops(name)")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("order_history")
      .select("id, order_id, previous_status, new_status, created_at, orders(shops(name))")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("sync_history")
      .select("id, type, status, started_at, shops(name)")
      .order("started_at", { ascending: false })
      .limit(15),
    // One consolidated fetch reused for 3 things below: Recent Activity's
    // "connected/disconnected" and "spreadsheet regenerated" events, and the
    // Audit section's Last Shop Connected/Disconnected/Spreadsheet Generated
    // — all derivable from the same small set of columns, so one query
    // replaces what would otherwise be 3+ separate ones.
    supabase.from("shops").select("id, name, store_url, credentials_changed_at, sheet_regenerated_at, created_at"),
    supabase
      .from("sync_history")
      .select("status")
      .eq("type", "orders")
      .order("started_at", { ascending: false })
      .limit(10),
    // ---- Workflow Engine integration — same query shapes as their sync
    // equivalents above, applied to workflows/workflow_executions.
    supabase.rpc("get_workflows_with_stats"),
    supabase.rpc("get_workflow_performance_stats"),
    supabase
      .from("workflow_executions")
      .select("*", { count: "exact", head: true })
      .gte("started_at", todayStart.toISOString()),
    supabase
      .from("workflow_executions")
      .select("*", { count: "exact", head: true })
      .gte("started_at", todayStart.toISOString())
      .eq("status", "failed"),
    supabase
      .from("workflow_executions")
      .select("id, step_order, module_name, status, started_at, workflows(name, shops(name))")
      .order("started_at", { ascending: false })
      .limit(15),
    // No .limit() here — same "no pagination, filtered by date range
    // instead" rule as Error Center.
    supabase
      .from("workflow_executions")
      .select("id, step_order, module_name, message, started_at, workflows(name, shops(name))")
      .eq("status", "failed")
      .gte("started_at", workflowErrorFilterStart.toISOString())
      .order("started_at", { ascending: false }),
    supabase
      .from("workflow_executions")
      .select("status")
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  const criticalError =
    shopsResult.error ??
    ordersPerDayResult.error ??
    productStatsResult.error ??
    performanceResult.error ??
    workflowsStatsResult.error ??
    workflowPerformanceResult.error;

  if (criticalError) {
    console.error("Admin page load failed:", criticalError);
    return (
      <ErrorBanner message="We couldn't load the administration center right now. Please refresh the page in a moment." />
    );
  }

  const shops = shopsResult.data as ShopWithStats[];
  const ordersPerDay = ordersPerDayResult.data as { day: string; orders_count: number }[];
  const productStats = (productStatsResult.data as { total_products: number | string }[])[0];
  const performance = (
    performanceResult.data as {
      avg_duration_ms: number;
      max_duration_ms: number;
      min_duration_ms: number;
      success_rate: number;
      avg_imported_orders: number;
      avg_imported_products: number;
    }[]
  )[0];
  const shopsExtra = (shopsExtraResult.data ?? []) as {
    id: number;
    name: string;
    store_url: string | null;
    credentials_changed_at: string | null;
    sheet_regenerated_at: string | null;
    created_at: string;
  }[];
  const workflowsStats = (workflowsStatsResult.data ?? []) as WorkflowWithStats[];
  // The full array above still backs the KPIs below (totalWorkflows,
  // activeWorkflows) — this only bounds how many rows the Workflow
  // Statistics *table* renders, same "recent N" convention as every other
  // table on this page (Recent Orders, Recent Syncs, ...), which cap at the
  // query level via .limit() instead since they don't also feed a KPI
  // count. get_workflows_with_stats() is already ordered newest-first, so
  // this keeps the newest workflows visible rather than an arbitrary slice.
  const WORKFLOW_STATS_TABLE_LIMIT = 100;
  const workflowsStatsForTable = workflowsStats.slice(0, WORKFLOW_STATS_TABLE_LIMIT);
  const workflowPerformance = (
    workflowPerformanceResult.data as {
      avg_duration_ms: number;
      max_duration_ms: number;
      min_duration_ms: number;
      success_rate: number;
      total_executions: number;
    }[]
  )[0];

  // ---- Global System KPIs ----
  const totalShops = shops.length;
  const connectedShops = shops.filter((s) => s.store_url).length;
  const disconnectedShops = totalShops - connectedShops;
  const ordersToday = Number(ordersPerDay.find((d) => d.day === todayStr)?.orders_count ?? 0);
  const ordersThisMonth = ordersPerDay
    .filter((d) => d.day.startsWith(monthPrefix))
    .reduce((sum, d) => sum + Number(d.orders_count), 0);
  const syncsToday = syncsTodayResult.count ?? 0;
  const failedSyncsToday = failedSyncsTodayResult.count ?? 0;

  // ---- Execution Metrics ---- (same derivation style as the KPIs above —
  // counts from the workflows array already fetched, plus 2 head-count
  // queries on workflow_executions, mirroring syncsToday/failedSyncsToday)
  const totalWorkflows = workflowsStats.length;
  const activeWorkflows = workflowsStats.filter((w) => w.is_active).length;
  const draftWorkflows = totalWorkflows - activeWorkflows;
  const executionsToday = executionsTodayResult.count ?? 0;
  const failedExecutionsToday = failedExecutionsTodayResult.count ?? 0;

  // ---- System Health ---- (all derived from data already fetched above —
  // no live pings to Supabase, Google, or any connector; see lib/system-health.ts)
  const shopsWithNextSync = shops.map((shop) => ({
    ...shop,
    nextSyncAt: shop.store_url ? computeNextSyncAt(shop) : null,
  }));
  const databaseHealth = computeDatabaseHealth();
  const googleSheetsHealth = computeGoogleSheetsHealth(
    (recentOrderSyncsResult.data ?? []) as { status: "success" | "failed" }[]
  );
  const cronHealth = computeCronHealth(shopsWithNextSync);
  // Same function, called once per platform — computePlatformConnectorsHealth()
  // is already platform-agnostic (it just looks at whatever shops it's
  // given), so 3 per-platform cards need zero changes to lib/system-health.ts.
  const shopifyHealth = computePlatformConnectorsHealth(
    shops.filter((s) => s.platform === "Shopify")
  );
  const wooCommerceHealth = computePlatformConnectorsHealth(
    shops.filter((s) => s.platform === "WooCommerce")
  );
  const youCanHealth = computePlatformConnectorsHealth(shops.filter((s) => s.platform === "YouCan"));
  const workflowHealth = computeWorkflowHealth(
    (recentExecutionStatusesResult.data ?? []) as { status: "success" | "failed" }[]
  );

  // ---- Recent Activity ---- (existing tables merged and re-sorted — no
  // event bus, no new table, just a plain in-memory merge, capped at 30)
  const recentOrders = recentOrdersResult.data ?? [];
  const recentStatusChanges = recentStatusChangesResult.data ?? [];
  const recentSyncs = recentSyncsResult.data ?? [];
  const recentCredentialChanges = shopsExtra.filter((s) => s.credentials_changed_at);
  const recentRegenerations = shopsExtra.filter((s) => s.sheet_regenerated_at);

  const activity: ActivityItem[] = [
    ...recentOrders.map((o: Record<string, unknown>) => ({
      id: `order-${o.id}`,
      timestamp: o.created_at as string,
      description: `Order imported: ${o.product ?? "item"} for ${o.customer_name ?? "a customer"} (${(o.shops as { name: string } | null)?.name ?? "unknown shop"})`,
    })),
    ...recentStatusChanges.map((h: Record<string, unknown>) => {
      const shopName = (h.orders as { shops: { name: string } | null } | null)?.shops?.name;
      return {
        id: `status-${h.id}`,
        timestamp: h.created_at as string,
        description: `Order #${h.order_id} status changed ${h.previous_status ?? "new"} → ${h.new_status}${shopName ? ` (${shopName})` : ""}`,
      };
    }),
    ...recentSyncs.map((s: Record<string, unknown>) => ({
      id: `sync-${s.id}`,
      timestamp: s.started_at as string,
      description: `${s.type === "products" ? "Product" : "Order"} sync ${s.status === "success" ? "succeeded" : "failed"} (${(s.shops as { name: string } | null)?.name ?? "unknown shop"})`,
    })),
    ...recentCredentialChanges.map((s) => ({
      id: `cred-${s.id}`,
      timestamp: s.credentials_changed_at!,
      description: `${s.store_url ? "Reconnected" : "Disconnected"}: ${s.name}`,
    })),
    ...recentRegenerations.map((s) => ({
      id: `regen-${s.id}`,
      timestamp: s.sheet_regenerated_at!,
      description: `Spreadsheet regenerated: ${s.name}`,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 30);

  const errorCenter = errorCenterResult.data ?? [];

  // ---- Recent Workflow Activity / Failed Executions ---- (own dedicated
  // tables, same reasoning as Synchronization Monitoring/Error Center being
  // separate from the generic Recent Activity feed — workflow step
  // attempts are numerous and technical enough to deserve their own view
  // rather than crowding the general timeline)
  const recentWorkflowExecutions = recentWorkflowExecutionsResult.data ?? [];
  const failedWorkflowExecutions = failedWorkflowExecutionsResult.data ?? [];

  // ---- Audit ---- (reuses shopsExtra + recentOrders + Supabase Auth's own
  // last_sign_in_at — no new audit table/framework)
  function effectiveConnectTime(s: (typeof shopsExtra)[number]) {
    return s.credentials_changed_at ?? s.created_at;
  }
  const connectedForAudit = shopsExtra.filter((s) => s.store_url);
  const lastShopConnected =
    connectedForAudit.length > 0
      ? connectedForAudit.reduce((latest, s) =>
          effectiveConnectTime(s) > effectiveConnectTime(latest) ? s : latest
        )
      : null;
  const lastShopDisconnected = shopsExtra
    .filter((s) => !s.store_url && s.credentials_changed_at)
    .reduce<(typeof shopsExtra)[number] | null>(
      (latest, s) =>
        !latest || s.credentials_changed_at! > latest.credentials_changed_at!
          ? s
          : latest,
      null
    );
  const lastSpreadsheetShop = shopsExtra
    .filter((s) => s.sheet_regenerated_at)
    .reduce<(typeof shopsExtra)[number] | null>(
      (latest, s) =>
        !latest || s.sheet_regenerated_at! > latest.sheet_regenerated_at! ? s : latest,
      null
    );
  const lastOrderImported = recentOrders[0] as Record<string, unknown> | undefined;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Administration &amp; Monitoring Center</h1>
        <div className="flex items-center gap-3">
          <form action={refreshDashboard}>
            <SubmitButton variant="secondary" pendingLabel="Refreshing…">
              Refresh Dashboard
            </SubmitButton>
          </form>
          <form action={runSyncNow}>
            <SubmitButton pendingLabel="Syncing…">Run Synchronization Now</SubmitButton>
          </form>
        </div>
      </div>

      {sp.synced !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Synchronization complete for {sp.synced} shop(s).
        </p>
      )}
      {sp.tested !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Tested {sp.tested} connection(s): {sp.tests_passed} passed, {sp.tests_failed} failed.
        </p>
      )}
      {sp.workflow_retried !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Retried {sp.workflow_retried} failed workflow execution(s).
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Global System KPIs</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Total Shops" value={totalShops} />
          <StatCard label="Connected Shops" value={connectedShops} />
          <StatCard label="Disconnected Shops" value={disconnectedShops} />
          <StatCard label="Orders Today" value={ordersToday} />
          <StatCard label="Orders This Month" value={ordersThisMonth} />
          <StatCard label="Products" value={Number(productStats?.total_products ?? 0)} />
          <StatCard label="Synchronizations Today" value={syncsToday} />
          <StatCard label="Failed Synchronizations" value={failedSyncsToday} />
          <StatCard
            label="Average Sync Duration"
            value={formatDuration(Number(performance?.avg_duration_ms ?? 0))}
          />
          <StatCard label="Success Rate" value={`${performance?.success_rate ?? 0}%`} />
        </div>

        {ordersPerDay.length > 0 && (
          <div className="mt-4 rounded-lg border bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Orders per Day</h3>
            <OrdersPerDayChart data={ordersPerDay} />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Execution Metrics</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Total Workflows" value={totalWorkflows} />
          <StatCard label="Active Workflows" value={activeWorkflows} />
          <StatCard label="Draft Workflows" value={draftWorkflows} />
          <StatCard label="Step Executions Today" value={executionsToday} />
          <StatCard label="Failed Executions Today" value={failedExecutionsToday} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">System Health</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">Database</p>
            <div className="mt-1">
              <SystemHealthBadge status={databaseHealth} />
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">Google Sheets</p>
            <div className="mt-1">
              <SystemHealthBadge status={googleSheetsHealth} />
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">Cron Scheduler</p>
            <div className="mt-1">
              <SystemHealthBadge status={cronHealth} />
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">Workflow Engine</p>
            <div className="mt-1">
              <SystemHealthBadge status={workflowHealth} />
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">Shopify Connector</p>
            <div className="mt-1">
              <SystemHealthBadge status={shopifyHealth} />
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">WooCommerce Connector</p>
            <div className="mt-1">
              <SystemHealthBadge status={wooCommerceHealth} />
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">YouCan Connector</p>
            <div className="mt-1">
              <SystemHealthBadge status={youCanHealth} />
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Synchronization Monitoring</h2>
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shop</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Imported Products</TableHead>
                <TableHead>Imported Orders</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shops.map((shop) => (
                <TableRow key={shop.id}>
                  <TableCell>{shop.name}</TableCell>
                  <TableCell>{shop.platform}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {shop.last_sync_attempt_at
                      ? formatRelativeTime(new Date(shop.last_sync_attempt_at))
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    {shop.last_sync_duration_ms !== null
                      ? formatDuration(shop.last_sync_duration_ms)
                      : "—"}
                  </TableCell>
                  <TableCell>{shop.last_products_imported_count ?? "—"}</TableCell>
                  <TableCell>{shop.last_orders_imported_count ?? "—"}</TableCell>
                  <TableCell>
                    {shop.last_sync_status ? (
                      <span
                        className={
                          shop.last_sync_status === "success" ? "text-green-700" : "text-red-700"
                        }
                      >
                        {shop.last_sync_status === "success" ? "Success" : "Failed"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {shop.last_sync_status === "failed" ? (shop.last_sync_message ?? "—") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {shops.length === 0 && (
            <p className="p-6 text-center text-gray-500">No shops yet.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Workflow Statistics</h2>
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Trigger Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Step Executions</TableHead>
                <TableHead>Success Rate</TableHead>
                <TableHead>Last Execution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflowsStatsForTable.map((workflow) => {
                const successRate =
                  workflow.execution_count > 0
                    ? Math.round((workflow.success_count / workflow.execution_count) * 1000) / 10
                    : null;
                return (
                  <TableRow key={workflow.id}>
                    <TableCell>{workflow.name}</TableCell>
                    <TableCell>{workflow.shop_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{workflow.trigger_event}</TableCell>
                    <TableCell>
                      <span
                        className={
                          workflow.is_active
                            ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"
                            : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600"
                        }
                      >
                        {workflow.is_active ? "Active" : "Draft"}
                      </span>
                    </TableCell>
                    <TableCell>{workflow.step_count}</TableCell>
                    <TableCell>{workflow.execution_count}</TableCell>
                    <TableCell>{successRate !== null ? `${successRate}%` : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {workflow.last_execution_at
                        ? formatRelativeTime(new Date(workflow.last_execution_at))
                        : "Never"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {workflowsStats.length === 0 && (
            <p className="p-6 text-center text-gray-500">No workflows yet.</p>
          )}
          {workflowsStats.length > WORKFLOW_STATS_TABLE_LIMIT && (
            <p className="border-t p-3 text-center text-xs text-gray-500">
              Showing the {WORKFLOW_STATS_TABLE_LIMIT} most recent workflows of {workflowsStats.length} total.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent Activity</h2>
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap text-gray-500">
                    {formatRelativeTime(new Date(item.timestamp))}
                  </TableCell>
                  <TableCell>{item.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {activity.length === 0 && (
            <p className="p-6 text-center text-gray-500">No activity yet.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent Workflow Activity</h2>
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentWorkflowExecutions.map((entry: Record<string, unknown>) => {
                const workflow = entry.workflows as
                  | { name: string; shops: { name: string } | null }
                  | null;
                return (
                  <TableRow key={entry.id as number}>
                    <TableCell className="whitespace-nowrap text-gray-500">
                      {formatRelativeTime(new Date(entry.started_at as string))}
                    </TableCell>
                    <TableCell>{workflow?.name ?? "—"}</TableCell>
                    <TableCell>{workflow?.shops?.name ?? "—"}</TableCell>
                    <TableCell>{entry.step_order as number}</TableCell>
                    <TableCell>{entry.module_name as string}</TableCell>
                    <TableCell>
                      <span
                        className={
                          entry.status === "success" ? "text-green-700" : "text-red-700"
                        }
                      >
                        {entry.status === "success" ? "Success" : "Failed"}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {recentWorkflowExecutions.length === 0 && (
            <p className="p-6 text-center text-gray-500">No workflow executions yet.</p>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Error Center</h2>
          <div className="flex items-center gap-3 text-sm">
            {ERROR_FILTERS.map((filter) => (
              <Link
                key={filter}
                href={`/admin?error_filter=${filter}#error-center`}
                className={
                  filter === errorFilter
                    ? "font-semibold text-blue-600 underline"
                    : "text-blue-600 hover:underline"
                }
              >
                {filter === "today" ? "Today" : filter === "week" ? "This Week" : "This Month"}
              </Link>
            ))}
          </div>
        </div>
        <div id="error-center" className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errorCenter.map((entry: Record<string, unknown>) => {
                const shop = entry.shops as { name: string; platform: string } | null;
                return (
                  <TableRow key={entry.id as number}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(entry.started_at as string).toLocaleString()}
                    </TableCell>
                    <TableCell>{shop?.name ?? "—"}</TableCell>
                    <TableCell>{shop?.platform ?? "—"}</TableCell>
                    <TableCell className="capitalize">{entry.type as string}</TableCell>
                    <TableCell>{(entry.message as string | null) ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {errorCenter.length === 0 && (
            <p className="p-6 text-center text-gray-500">
              No synchronization failures {errorFilter === "today" ? "today" : `this ${errorFilter}`}.
            </p>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Failed Executions</h2>
          <div className="flex items-center gap-3 text-sm">
            {ERROR_FILTERS.map((filter) => (
              <Link
                key={filter}
                href={`/admin?workflow_error_filter=${filter}#failed-executions`}
                className={
                  filter === workflowErrorFilter
                    ? "font-semibold text-blue-600 underline"
                    : "text-blue-600 hover:underline"
                }
              >
                {filter === "today" ? "Today" : filter === "week" ? "This Week" : "This Month"}
              </Link>
            ))}
          </div>
        </div>
        <div id="failed-executions" className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failedWorkflowExecutions.map((entry: Record<string, unknown>) => {
                const workflow = entry.workflows as
                  | { name: string; shops: { name: string } | null }
                  | null;
                return (
                  <TableRow key={entry.id as number}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(entry.started_at as string).toLocaleString()}
                    </TableCell>
                    <TableCell>{workflow?.name ?? "—"}</TableCell>
                    <TableCell>{workflow?.shops?.name ?? "—"}</TableCell>
                    <TableCell>{entry.step_order as number}</TableCell>
                    <TableCell>{entry.module_name as string}</TableCell>
                    <TableCell>{(entry.message as string | null) ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {failedWorkflowExecutions.length === 0 && (
            <p className="p-6 text-center text-gray-500">
              No failed workflow executions{" "}
              {workflowErrorFilter === "today" ? "today" : `this ${workflowErrorFilter}`}.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Performance Metrics</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard
            label="Average Sync Duration"
            value={formatDuration(Number(performance?.avg_duration_ms ?? 0))}
          />
          <StatCard
            label="Fastest Sync"
            value={formatDuration(Number(performance?.min_duration_ms ?? 0))}
          />
          <StatCard
            label="Slowest Sync"
            value={formatDuration(Number(performance?.max_duration_ms ?? 0))}
          />
          <StatCard
            label="Average Imported Orders"
            value={Number(performance?.avg_imported_orders ?? 0)}
          />
          <StatCard
            label="Average Imported Products"
            value={Number(performance?.avg_imported_products ?? 0)}
          />
          <StatCard label="Success Rate" value={`${performance?.success_rate ?? 0}%`} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Workflow Performance</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard
            label="Average Step Duration"
            value={formatDuration(Number(workflowPerformance?.avg_duration_ms ?? 0))}
          />
          <StatCard
            label="Fastest Step"
            value={formatDuration(Number(workflowPerformance?.min_duration_ms ?? 0))}
          />
          <StatCard
            label="Slowest Step"
            value={formatDuration(Number(workflowPerformance?.max_duration_ms ?? 0))}
          />
          <StatCard
            label="Total Step Executions"
            value={Number(workflowPerformance?.total_executions ?? 0)}
          />
          <StatCard
            label="Step Success Rate"
            value={`${workflowPerformance?.success_rate ?? 0}%`}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Audit</h2>
        <div className="rounded-lg border bg-white p-6">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Last Login</dt>
              <dd className="font-medium">
                {user.user?.last_sign_in_at
                  ? formatRelativeTime(new Date(user.user.last_sign_in_at))
                  : "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Last Shop Connected</dt>
              <dd className="font-medium">
                {lastShopConnected
                  ? `${lastShopConnected.name} (${formatRelativeTime(new Date(effectiveConnectTime(lastShopConnected)))})`
                  : "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Last Shop Disconnected</dt>
              <dd className="font-medium">
                {lastShopDisconnected
                  ? `${lastShopDisconnected.name} (${formatRelativeTime(new Date(lastShopDisconnected.credentials_changed_at!))})`
                  : "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Last Spreadsheet Generated</dt>
              <dd className="font-medium">
                {lastSpreadsheetShop
                  ? `${lastSpreadsheetShop.name} (${formatRelativeTime(new Date(lastSpreadsheetShop.sheet_regenerated_at!))})`
                  : "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Last Order Imported</dt>
              <dd className="font-medium">
                {lastOrderImported
                  ? `${lastOrderImported.customer_name ?? "a customer"} — ${(lastOrderImported.shops as { name: string } | null)?.name ?? "unknown shop"} (${formatRelativeTime(new Date(lastOrderImported.created_at as string))})`
                  : "—"}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Maintenance</h2>
        <div className="rounded-lg border bg-white p-6">
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between">
              <span>Run synchronization now across every connected shop.</span>
              <form action={runSyncNow}>
                <SubmitButton variant="secondary" pendingLabel="Syncing…">
                  Run Synchronization Now
                </SubmitButton>
              </form>
            </li>
            <li className="flex items-center justify-between">
              <span>Refresh this dashboard with the latest data.</span>
              <form action={refreshDashboard}>
                <SubmitButton variant="secondary" pendingLabel="Refreshing…">
                  Refresh Dashboard
                </SubmitButton>
              </form>
            </li>
            <li className="flex items-center justify-between">
              <span>Test every connected shop&apos;s connection right now.</span>
              <form action={testAllConnections}>
                <SubmitButton variant="secondary" pendingLabel="Testing…">
                  Test All Connections
                </SubmitButton>
              </form>
            </li>
            <li className="flex items-center justify-between">
              <span>
                Retry today&apos;s failed workflow executions.{" "}
                <span className="text-xs text-gray-400">
                  (re-runs the whole workflow from step 1 — the engine has no per-step resume yet)
                </span>
              </span>
              <form action={retryFailedWorkflowExecutions}>
                <SubmitButton variant="secondary" pendingLabel="Retrying…">
                  Retry Failed Executions
                </SubmitButton>
              </form>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-400">
                Clear temporary cache <span className="text-xs">(coming soon)</span>
              </span>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-md border px-4 py-2 text-sm font-medium text-gray-400"
              >
                Clear Cache
              </button>
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
