"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { runSyncForShops, toPlatformCredentials, type SyncableShop } from "@/lib/sync";
import { getConnector } from "@/lib/platforms";
import { retryWorkflowExecutions } from "@/lib/workflows/retry";
import { startOfTodayUTC } from "@/lib/utils";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// Manual, forced sync across every one of the caller's connected shops —
// bypasses the schedule (unlike the cron, which only syncs shops that are
// actually due) but reuses the exact same per-shop sync loop
// (lib/sync.ts's runSyncForShops(), shared with app/api/cron/sync/route.ts)
// rather than a second copy of it. Still respects each shop's own
// product/order sync toggles (Store Settings): "run now" means "don't wait
// for the schedule", not "ignore what I asked you not to sync".
//
// Shops are fetched via the user-scoped client, not the service-role one —
// this is a real logged-in user's request, so RLS's "Users can view their
// own shops" policy is what scopes it to their shops, with no manual filter.
export async function runSyncNow() {
  const supabase = await createSupabaseServerClient();

  const { data: shops, error } = await supabase
    .from("shops")
    .select(
      "id, platform, sheet_id, store_url, api_key, api_secret, last_synced_at, sync_products_enabled, sync_orders_enabled"
    )
    .not("store_url", "is", null)
    .not("api_key", "is", null);

  if (error) {
    console.error("runSyncNow: failed to load shops:", error);
    redirect(`/admin?error=${encodeURIComponent("Could not load shops to sync.")}`);
  }

  const results = await runSyncForShops((shops ?? []) as SyncableShop[]);

  redirect(`/admin?synced=${results.length}`);
}

// revalidate = 0 on /admin (like every other page here) already means it
// never caches, so this mostly just forces a fresh navigation — included
// because "Refresh Dashboard" was asked for explicitly as its own control,
// not because there's meaningful cached data to invalidate. "Refresh
// Statistics" is wired to this exact same action rather than a second,
// functionally-identical copy of it — with zero caching anywhere on this
// page, the two buttons would only ever do the same thing.
export async function refreshDashboard() {
  revalidatePath("/admin");
  redirect("/admin");
}

// Reuses the connector architecture directly (getConnector().testConnection),
// the same method the single-shop testConnection() Server Action
// (app/shops/connect/actions.ts) already calls — that action is shaped for
// one shop_id from a form, so looping it wouldn't fit here without building
// fake FormData; calling the connector method it wraps is the real "existing
// connection logic" being reused, not a second implementation of it.
// Results are only ever shown as a transient summary, never written to
// sync_history — a manual test isn't a sync attempt, same distinction the
// Connected Stores Management feature already established.
export async function testAllConnections() {
  // Same reasoning as testConnection()'s own rate limit
  // (app/shops/connect/actions.ts): every connected shop's platform API
  // gets a live request here, so this is the most expensive single click
  // available to an authenticated caller — worth its own limit rather than
  // relying on the general page-load traffic to bound it.
  const ip = getClientIp(await headers());
  const rateLimit = checkRateLimit(`admin-test-connections:${ip}`, { max: 10, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    logger.warn("admin.test_connections_rate_limited", { ip });
    redirect(`/admin?error=${encodeURIComponent("Too many requests. Please wait a moment and try again.")}`);
  }

  const supabase = await createSupabaseServerClient();

  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, platform, sheet_id, store_url, api_key, api_secret, last_synced_at")
    .not("store_url", "is", null)
    .not("api_key", "is", null);

  if (error) {
    console.error("testAllConnections: failed to load shops:", error);
    redirect(`/admin?error=${encodeURIComponent("Could not load shops to test.")}`);
  }

  let passed = 0;
  let failed = 0;

  for (const shop of shops ?? []) {
    try {
      const connector = getConnector(shop.platform);
      const ok = await connector.testConnection(toPlatformCredentials(shop));
      if (ok) {
        passed++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`testAllConnections: unexpected error for shop ${shop.id}:`, err);
      failed++;
    }
  }

  redirect(`/admin?tested=${passed + failed}&tests_passed=${passed}&tests_failed=${failed}`);
}

// Re-runs today's failed workflow executions — reuses the exact same
// runWorkflow() the Execution Engine calls for real events (same
// relationship as "Test Workflow Now" on the Builder's editor page), not a
// second execution path. Scoped to today: bounds a retry from re-sending
// months-old side effects (a WhatsApp message, a webhook) a second time.
// Several failed steps from the same run are deduplicated to one retry of
// that (workflow, order) pair, not one retry per failed step. The actual
// batched lookups + retry loop live once in lib/workflows/retry.ts's
// retryWorkflowExecutions(), shared with the automation-retry cron
// (app/api/cron/automation-retry/route.ts) — this action only decides
// *which* pairs qualify (every failure from today, no backoff gating: a
// human clicking this button wants everything retried right now) and
// which client to read/write with (the caller's own RLS-scoped session,
// not the cron's service-role client).
export async function retryFailedWorkflowExecutions() {
  const supabase = await createSupabaseServerClient();
  const todayStart = startOfTodayUTC();

  const { data: failedExecutions, error } = await supabase
    .from("workflow_executions")
    .select("workflow_id, order_id")
    .eq("status", "failed")
    .gte("started_at", todayStart.toISOString());

  if (error) {
    console.error("retryFailedWorkflowExecutions: failed to load failed executions:", error);
    redirect(`/admin?error=${encodeURIComponent("Could not load failed executions to retry.")}`);
  }

  const uniquePairs = Array.from(
    new Map(
      (failedExecutions ?? []).map((e) => [`${e.workflow_id}:${e.order_id}`, e])
    ).values()
  );

  const retried = await retryWorkflowExecutions(supabase, uniquePairs);

  redirect(`/admin?workflow_retried=${retried}`);
}
