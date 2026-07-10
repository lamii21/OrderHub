"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { runSyncForShops, toPlatformCredentials, type SyncableShop } from "@/lib/sync";
import { getConnector } from "@/lib/platforms";
import { runWorkflow } from "@/lib/workflows/engine";
import { startOfTodayUTC } from "@/lib/utils";
import type { WorkflowStep } from "@/types/workflow";
import type { Order } from "@/types/order";

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
// that (workflow, order) pair, not one retry per failed step. Any step that
// already succeeded earlier today for that same pair is passed to
// runWorkflow() as skipStepOrders so the retry only actually re-sends the
// steps that failed, not the whole workflow from step 1 (see engine.ts's
// RunWorkflowOptions comment for the one accepted trade-off).
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

  if (uniquePairs.length === 0) {
    redirect(`/admin?workflow_retried=0`);
  }

  const workflowIds = Array.from(new Set(uniquePairs.map((p) => p.workflow_id)));
  const orderIds = Array.from(new Set(uniquePairs.map((p) => p.order_id)));

  // 3 batched lookups instead of up to 2 queries per unique pair in a loop
  // — a backlog of, say, 40 distinct failed (workflow, order) pairs used to
  // mean up to 80 round trips; now it's always exactly 3, however many
  // pairs there are. Safe to run in parallel: none of these three depend on
  // each other's result, they're only joined together afterward in memory.
  const [
    { data: workflows, error: workflowsError },
    { data: orders, error: ordersError },
    { data: succeededSteps, error: succeededError },
  ] = await Promise.all([
    supabase.from("workflows").select("*, workflow_steps(*)").in("id", workflowIds),
    supabase.from("orders").select("*, shops(name, platform)").in("id", orderIds),
    // Steps that already succeeded today for these exact (workflow, order)
    // pairs — the basis for skipStepOrders below.
    supabase
      .from("workflow_executions")
      .select("workflow_id, order_id, step_order")
      .eq("status", "success")
      .gte("started_at", todayStart.toISOString())
      .in("workflow_id", workflowIds)
      .in("order_id", orderIds),
  ]);

  if (workflowsError || ordersError || succeededError) {
    console.error(
      "retryFailedWorkflowExecutions: failed to load retry data:",
      workflowsError ?? ordersError ?? succeededError
    );
    redirect(`/admin?error=${encodeURIComponent("Could not load data needed to retry.")}`);
  }

  const workflowsById = new Map(
    (workflows ?? []).map((workflow) => {
      const { workflow_steps, ...workflowFields } = workflow as typeof workflow & {
        workflow_steps: WorkflowStep[];
      };
      const steps = [...workflow_steps].sort((a, b) => a.step_order - b.step_order);
      return [workflow.id, { ...workflowFields, steps }];
    })
  );
  const ordersById = new Map((orders ?? []).map((order) => [order.id, order]));

  const succeededStepsByPair = new Map<string, Set<number>>();
  for (const row of succeededSteps ?? []) {
    const key = `${row.workflow_id}:${row.order_id}`;
    const set = succeededStepsByPair.get(key) ?? new Set<number>();
    set.add(row.step_order);
    succeededStepsByPair.set(key, set);
  }

  let retried = 0;

  for (const { workflow_id, order_id } of uniquePairs) {
    const workflow = workflowsById.get(workflow_id);
    const order = ordersById.get(order_id);

    if (!workflow || !order) {
      continue;
    }

    const skipStepOrders = succeededStepsByPair.get(`${workflow_id}:${order_id}`);

    try {
      await runWorkflow(workflow, order as Order, { skipStepOrders });
      retried++;
    } catch (err) {
      console.error(
        `retryFailedWorkflowExecutions: retry failed for workflow ${workflow_id}, order ${order_id}:`,
        err
      );
    }
  }

  redirect(`/admin?workflow_retried=${retried}`);
}
