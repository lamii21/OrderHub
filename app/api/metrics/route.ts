import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { matchesAnySecret, requireEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const LOOKBACK_MS = 24 * 60 * 60 * 1000;

// Same secret as the two cron routes — this is another machine-to-machine
// endpoint (an external monitor/dashboard polling for a snapshot, not a
// user's browser), so it reuses CRON_SECRET rather than provisioning and
// documenting a 3rd secret for the same "internal caller" trust level.
function isValidMetricsSecret(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;

  requireEnv("CRON_SECRET");
  const provided = authHeader.slice("Bearer ".length);
  return matchesAnySecret(provided, "CRON_SECRET", "CRON_SECRET_PREVIOUS");
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function successRate(rows: { status: string }[]): number | null {
  if (rows.length === 0) return null;
  const ok = rows.filter((r) => r.status === "success").length;
  return Math.round((ok / rows.length) * 1000) / 10;
}

// A compact operational snapshot for whatever polls it externally (Grafana
// agent, a scheduled digest, an uptime dashboard) — global, service-role
// counts computed fresh on every call, not the per-user RLS-scoped
// aggregates the dashboard pages use (those are scoped to whichever user is
// logged in; this endpoint has no user at all). Deliberately not a
// Prometheus /metrics text endpoint or a new metrics-store dependency —
// same "no new infrastructure by default" posture as lib/logger.ts and
// lib/rate-limit.ts; plain JSON is enough for this project's scale, and a
// real APM's scraper can wrap this response if one is ever added.
export async function GET(request: NextRequest) {
  const rateLimit = checkRateLimit(`metrics:${clientIp(request)}`, { max: 30, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000)) } }
    );
  }

  if (!isValidMetricsSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  const [shopsResult, ordersResult, recentOrdersResult, recentSyncsResult, recentExecutionsResult] =
    await Promise.all([
      supabase.from("shops").select("id", { count: "exact", head: true }),
      supabase.from("orders").select("id", { count: "exact", head: true }),
      supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", since),
      supabase.from("sync_history").select("status").gte("started_at", since),
      supabase.from("workflow_executions").select("status").gte("started_at", since),
    ]);

  const errors = [
    shopsResult.error,
    ordersResult.error,
    recentOrdersResult.error,
    recentSyncsResult.error,
    recentExecutionsResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    logger.error("metrics.query_failed", { errors: errors.map((e) => String(e)) });
    return NextResponse.json({ success: false, error: "Could not load metrics." }, { status: 500 });
  }

  const recentSyncs = (recentSyncsResult.data ?? []) as { status: string }[];
  const recentExecutions = (recentExecutionsResult.data ?? []) as { status: string }[];

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    windowHours: 24,
    shops: { total: shopsResult.count ?? 0 },
    orders: { total: ordersResult.count ?? 0, last24h: recentOrdersResult.count ?? 0 },
    sync: { attempts24h: recentSyncs.length, successRate24h: successRate(recentSyncs) },
    workflowExecutions: {
      attempts24h: recentExecutions.length,
      successRate24h: successRate(recentExecutions),
    },
  });
}
