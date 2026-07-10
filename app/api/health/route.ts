import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkEnvironment } from "@/lib/env-validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// Unauthenticated on purpose — an uptime monitor (or a load balancer's own
// health probe) needs to reach this without a secret, and it exposes
// nothing sensitive: just booleans and counts. This is the 3rd API Route
// Handler in the app (the other two are the /api/orders webhook and
// /api/cron/sync) — a deliberate, standard exception to "everything is a
// Server Action", since a health check is inherently an HTTP endpoint an
// external monitor polls, not a user-triggered form submission.
//
// Being unauthenticated is exactly why it needs its own rate limit: with no
// secret to check, it's the cheapest possible target for someone to hammer
// (each hit still does a real database round trip). The limit is generous
// relative to the webhook/cron ones — legitimate uptime monitors commonly
// poll every 10-30s from a handful of source IPs (their own probe fleet),
// so 30/min per IP comfortably covers that while still bounding abuse.
export async function GET(request: NextRequest) {
  const rateLimit = checkRateLimit(`health:${clientIp(request)}`, { max: 30, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: "error", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000)) } }
    );
  }

  const { error, count } = await supabase
    .from("shops")
    .select("id", { count: "exact", head: true });

  const databaseOk = !error;
  const env = checkEnvironment();

  const ok = databaseOk && env.ok;

  if (!ok) {
    logger.error("health_check.degraded", {
      databaseOk,
      missingCoreEnv: env.missingCore,
    });
  }

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks: {
        database: databaseOk ? "ok" : "error",
        environment: env.ok ? "ok" : "missing_required_vars",
      },
      shopCount: databaseOk ? (count ?? 0) : null,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
