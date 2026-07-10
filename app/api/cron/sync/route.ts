import { NextRequest, NextResponse } from "next/server";
import { matchesAnySecret, requireEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { runSyncForShops, type SyncableShop } from "@/lib/sync";
import { isSyncDue } from "@/lib/sync-schedule";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// Raises the serverless function's own time limit above the platform
// default (commonly 10-15s) — needed now that a run can process up to
// MAX_SHOPS_PER_RUN shops at SYNC_CONCURRENCY (lib/sync.ts) in parallel
// rather than one at a time. 300s is the standard ceiling on Vercel's Pro
// tier without requesting a higher one; raise this (and the platform plan
// it requires) if MAX_SHOPS_PER_RUN is ever raised to match a bigger
// merchant base.
export const maxDuration = 300;

// However many shops are due, only this many are actually synced in one
// run — the rest stay due and are picked up by the next hourly run. This
// bounds a single invocation's wall-clock time regardless of how large the
// backlog gets, at the cost of a due shop occasionally waiting one extra
// cycle when the backlog is bigger than this — an acceptable degradation
// for something that runs hourly, not a correctness problem. At
// SYNC_CONCURRENCY=10 or so, 60 shops is comfortably inside maxDuration
// even if every single sync call takes close to its own internal timeout.
const MAX_SHOPS_PER_RUN = 60;

// Same shared constant-time comparison as the /api/orders webhook (see
// matchesAnySecret's own comment). CRON_SECRET_PREVIOUS is optional and
// only checked if set, for the same rotation-without-cutover reason.
function isValidCronSecret(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;

  requireEnv("CRON_SECRET"); // fail fast if the primary secret isn't configured at all
  const provided = authHeader.slice("Bearer ".length);
  return matchesAnySecret(provided, "CRON_SECRET", "CRON_SECRET_PREVIOUS");
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// Triggered on a schedule (Vercel Cron or an external scheduler — see
// vercel.json), never by a browser. Vercel's own Cron Jobs automatically
// send "Authorization: Bearer <CRON_SECRET>" when a project has an env var
// named exactly CRON_SECRET, which is what this checks against.
export async function GET(request: NextRequest) {
  // Checked before the secret, same order as the webhook: shed an abusive
  // caller's load before doing any real work, including the (cheap but
  // non-zero) constant-time secret comparison itself.
  const rateLimit = checkRateLimit(`cron:${clientIp(request)}`, { max: 10, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    logger.warn("cron.rate_limited", { ip: clientIp(request) });
    return NextResponse.json(
      { success: false, error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000)) } }
    );
  }

  if (!isValidCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // "Active" = actually connected to a live platform (has credentials to
  // sync with) — a Sheets-only shop from /shops/new has neither store_url
  // nor api_key and is never a candidate for automatic sync, same
  // condition /shops/[id] already uses to decide whether to show the sync
  // buttons at all.
  const { data: shops, error } = await supabase
    .from("shops")
    .select(
      "id, platform, sheet_id, store_url, api_key, api_secret, last_synced_at, sync_frequency, last_sync_attempt_at, auto_sync_enabled, sync_products_enabled, sync_orders_enabled"
    )
    .not("store_url", "is", null)
    .not("api_key", "is", null);

  if (error) {
    console.error("Cron sync: failed to load shops:", error);
    return NextResponse.json({ success: false, error: "Could not load shops." }, { status: 500 });
  }

  // auto_sync_enabled (Store Settings' Notification Settings) is the one
  // new gate here — a shop can have valid credentials and still opt out of
  // automatic sync entirely without disconnecting. It only ever affects
  // this loop; the manual "Sync Products Now"/"Sync Orders Now" buttons on
  // /shops/[id] stay unaffected by any of these toggles.
  //
  // Sorted oldest-attempt-first (never-attempted shops sort first, as if
  // their attempt were at the epoch) so that when there's a backlog bigger
  // than MAX_SHOPS_PER_RUN, the shops that have waited longest go first —
  // otherwise the same shops at the front of the query result would win
  // every single run and the rest would starve.
  const dueShops = (shops ?? [])
    .filter((shop) => shop.auto_sync_enabled && isSyncDue(shop))
    .sort((a, b) => {
      const aTime = a.last_sync_attempt_at ? new Date(a.last_sync_attempt_at).getTime() : 0;
      const bTime = b.last_sync_attempt_at ? new Date(b.last_sync_attempt_at).getTime() : 0;
      return aTime - bTime;
    }) as SyncableShop[];

  const shopsToSync = dueShops.slice(0, MAX_SHOPS_PER_RUN);

  // The actual per-shop sync loop lives once in lib/sync.ts, shared with
  // /admin's manual "Run Synchronization Now" — this route only decides
  // *which* shops qualify (due + auto-sync enabled) and how many to take
  // in one run, not how syncing itself happens.
  const results = await runSyncForShops(shopsToSync);
  const deferred = dueShops.length - shopsToSync.length;

  if (deferred > 0) {
    logger.warn("cron.backlog", { due: dueShops.length, synced: results.length, deferred });
  }

  return NextResponse.json({
    success: true,
    checked: shops?.length ?? 0,
    due: dueShops.length,
    synced: results.length,
    deferred,
    results,
  });
}
