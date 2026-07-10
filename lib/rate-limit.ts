// A fixed-window, in-memory rate limiter — deliberately not Redis-backed,
// consistent with this project's standing "no new infrastructure" rule.
//
// Honest limitation: on a serverless platform (Vercel functions), each
// warm instance has its own Map, and cold starts reset it entirely — this
// limits abuse per-instance, it does not enforce one global ceiling across
// every concurrent instance. That's still strictly better than no limit at
// all against a single misbehaving caller hammering one warm instance, and
// upgrading to a shared store (Redis, Supabase itself) is a drop-in
// replacement for checkRateLimit()'s body later if real abuse is observed
// — nothing about its call sites would need to change.
const WINDOW_MS = 60_000;

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

// Sized to bound memory, not to be exact — old buckets are swept out
// opportunistically on each call rather than with a timer (no background
// process to manage in a serverless function).
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs?: number };

export function checkRateLimit(
  key: string,
  { max = 60, windowMs = WINDOW_MS }: { max?: number; windowMs?: number } = {}
): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, bucket] of buckets) {
      if (now - bucket.windowStart > windowMs) {
        buckets.delete(k);
      }
    }
  }

  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1 };
  }

  if (existing.count >= max) {
    return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - existing.windowStart) };
  }

  existing.count += 1;
  return { allowed: true, remaining: max - existing.count };
}

// Test-only escape hatch — the module-scope Map otherwise leaks state
// across test cases.
export function __resetRateLimitState() {
  buckets.clear();
}
