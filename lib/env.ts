import { timingSafeEqual } from "crypto";

// Fails fast with a clear message instead of letting a missing env var surface
// later as a confusing error deep inside Supabase/Google/Shopify client code.
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env.local file (see .env.local.example).`
    );
  }

  return value;
}

// Shared by /api/orders and /api/cron/sync (both compared a provided secret
// against a single required env var with the same timingSafeEqual pattern,
// duplicated in each route). Checks the provided value against every env
// var named here that's actually set, so a "current secret" + "previous
// secret" pair lets a deployment rotate its shared secret without an
// instant cutover: the old value keeps working until whoever configured
// it (e.g. the Apps Script trigger, the external cron scheduler) is
// updated to the new one, then the *_PREVIOUS var can be unset.
export function matchesAnySecret(provided: string | null, ...envVarNames: string[]): boolean {
  if (!provided) return false;

  const providedBuf = Buffer.from(provided);

  return envVarNames.some((name) => {
    const expected = process.env[name];
    if (!expected) return false;

    const expectedBuf = Buffer.from(expected);
    return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  });
}
