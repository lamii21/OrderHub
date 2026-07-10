// System Health for /admin — computed entirely from data the page already
// fetched for its other sections. No live pings to Supabase, Google, or any
// platform connector: mirrors lib/shop-health.ts's own resting-state
// philosophy (a signal derived from recent recorded outcomes, not a
// real-time probe run on every page view).
export type HealthStatus = "healthy" | "warning" | "offline";

export const HEALTH_LABELS: Record<HealthStatus, { emoji: string; label: string }> = {
  healthy: { emoji: "🟢", label: "Healthy" },
  warning: { emoji: "🟡", label: "Warning" },
  offline: { emoji: "🔴", label: "Offline" },
};

// The page only reaches this section after every query above it already
// succeeded — a real database outage would already have produced an
// ErrorBanner instead of this page rendering at all (same pattern as every
// other page in this app), so reaching here already proves the database
// answered.
export function computeDatabaseHealth(): HealthStatus {
  return "healthy";
}

// Derived from the outcome of the most recent order syncs — the operation
// that actually writes into Google Sheets via appendOrderRows() — rather
// than calling the Sheets API just to check it's reachable.
export function computeGoogleSheetsHealth(
  recentOrderSyncs: { status: "success" | "failed" }[]
): HealthStatus {
  if (recentOrderSyncs.length === 0) return "healthy";
  const failedCount = recentOrderSyncs.filter((s) => s.status === "failed").length;
  if (failedCount === recentOrderSyncs.length) return "offline";
  if (failedCount > 0) return "warning";
  return "healthy";
}

type ShopForCronHealth = {
  store_url: string | null;
  auto_sync_enabled: boolean;
  nextSyncAt: Date | null;
};

// Reuses lib/sync-schedule.ts's own due-date math (the caller passes in
// nextSyncAt, already computed via computeNextSyncAt()) rather than
// recomputing it here. If an eligible shop's scheduled time has slipped by
// more than a couple of hours, the cron probably isn't firing on schedule —
// a small lag is expected (the cron itself only runs hourly), a full day is
// not. store_url alone is the same "has credentials" signal used throughout
// this app (get_shops_with_stats() never exposes api_key at all).
export function computeCronHealth(shops: ShopForCronHealth[]): HealthStatus {
  const eligible = shops.filter((s) => s.store_url && s.auto_sync_enabled);
  if (eligible.length === 0) return "healthy";

  const overdueHours = eligible.map((shop) => {
    if (!shop.nextSyncAt) return 0;
    const ms = Date.now() - shop.nextSyncAt.getTime();
    return ms > 0 ? ms / (1000 * 60 * 60) : 0;
  });

  const maxOverdue = Math.max(...overdueHours);
  if (maxOverdue > 24) return "offline";
  if (maxOverdue > 2) return "warning";
  return "healthy";
}

type ShopForConnectorHealth = {
  store_url: string | null;
  last_sync_status: "success" | "failed" | null;
};

// One combined signal across every connected platform (Shopify/WooCommerce/
// YouCan alike), reusing last_sync_status already returned by
// get_shops_with_stats() — no per-platform query needed.
export function computePlatformConnectorsHealth(shops: ShopForConnectorHealth[]): HealthStatus {
  const connected = shops.filter((s) => s.store_url);
  if (connected.length === 0) return "healthy";

  const failedCount = connected.filter((s) => s.last_sync_status === "failed").length;
  if (failedCount === connected.length) return "offline";
  if (failedCount > 0) return "warning";
  return "healthy";
}

// Same shape as computeGoogleSheetsHealth: derived from the outcome of the
// most recent workflow_executions rows (step attempts), not a live probe —
// there's nothing to "ping" for the Workflow Engine anyway, it's entirely
// in-process. An empty list (no workflows have ever run) reads as healthy,
// same "nothing to report is not the same as broken" rule used everywhere
// else in this file.
export function computeWorkflowHealth(
  recentExecutions: { status: "success" | "failed" }[]
): HealthStatus {
  if (recentExecutions.length === 0) return "healthy";
  const failedCount = recentExecutions.filter((e) => e.status === "failed").length;
  if (failedCount === recentExecutions.length) return "offline";
  if (failedCount > 0) return "warning";
  return "healthy";
}
