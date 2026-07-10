import { logger } from "@/lib/logger";

// Every requireEnv() call in this codebase (lib/env.ts) already fails fast
// — but only lazily, the first time that specific code path actually runs.
// A shop connect flow misconfigured for weeks could look fine until the
// first merchant hits "Connect Store" and gets a 500. This runs once at
// server startup (see instrumentation.ts) and reports the complete picture
// up front instead of one surprise at a time.
//
// Split into "core" (nothing works without these) and "optional" (a whole
// feature area is unavailable, but the rest of the app is fine) — a
// missing optional var is a loud warning, not a startup failure, since
// e.g. Google Sheets provisioning being unconfigured shouldn't take down
// order syncing.
const CORE_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "API_SECRET",
  "CRON_SECRET",
] as const;

const OPTIONAL_ENV_VARS = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_SHEETS_TEMPLATE_ID",
] as const;

export type EnvValidationResult = {
  ok: boolean;
  missingCore: string[];
  missingOptional: string[];
};

export function checkEnvironment(): EnvValidationResult {
  const missingCore = CORE_ENV_VARS.filter((name) => !process.env[name]);
  const missingOptional = OPTIONAL_ENV_VARS.filter((name) => !process.env[name]);

  return { ok: missingCore.length === 0, missingCore, missingOptional };
}

// Logs the result; never throws. A serverless platform doesn't give a
// clean way to abort startup from here, and refusing to boot at all would
// take down routes that don't need the missing var (e.g. dashboard pages
// don't need GOOGLE_SHEETS_TEMPLATE_ID) — requireEnv() at the actual call
// site is still what enforces "this specific operation can't proceed".
export function validateEnvironment() {
  const result = checkEnvironment();

  if (result.missingCore.length > 0) {
    logger.error("startup.env_validation_failed", { missing: result.missingCore });
  }

  if (result.missingOptional.length > 0) {
    logger.warn("startup.env_optional_missing", { missing: result.missingOptional });
  }

  if (result.ok && result.missingOptional.length === 0) {
    logger.info("startup.env_validation_passed");
  }

  return result;
}
