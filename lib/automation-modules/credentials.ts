import { supabase } from "@/lib/supabase";

// Every step of every workflow that calls an external API re-reads this on
// every single order — for a burst of orders in the same minute, that's
// the same row fetched over and over for no reason (module credentials
// change rarely: a merchant sets them once and rarely touches them again).
// A short in-memory TTL cache cuts that repeat load without meaningfully
// weakening correctness: a credential rotation takes up to CACHE_TTL_MS to
// take effect instead of being instant, which is an acceptable trade for
// how infrequently these are edited. Per-instance, like lib/rate-limit.ts
// — not shared across serverless instances, and deliberately not backed by
// Redis (this project's standing "no new infrastructure" rule).
const CACHE_TTL_MS = 60_000;

type CacheEntry = { value: Record<string, unknown> | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();

export async function getModuleCredentials(
  shopId: number,
  moduleName: string
): Promise<Record<string, unknown> | null> {
  const key = `${shopId}:${moduleName}`;
  const cached = cache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { data, error } = await supabase
    .from("module_credentials")
    .select("credentials")
    .eq("shop_id", shopId)
    .eq("module_name", moduleName)
    .maybeSingle();

  // A query error is never cached (worth retrying immediately, not worth
  // "remembering" a transient DB blip as if it were "not configured") —
  // only a genuine miss or a real value is.
  if (error) {
    return null;
  }

  const value = data ? (data.credentials as Record<string, unknown>) : null;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

// Test-only escape hatch, and useful if a future "save credentials" Server
// Action wants to invalidate immediately after a write instead of waiting
// out the TTL.
export function invalidateModuleCredentialsCache(shopId?: number, moduleName?: string) {
  if (shopId === undefined) {
    cache.clear();
    return;
  }

  if (moduleName === undefined) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${shopId}:`)) cache.delete(key);
    }
    return;
  }

  cache.delete(`${shopId}:${moduleName}`);
}
