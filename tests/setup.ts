// Runs once per test file, before that file's own imports are evaluated.
// Every lib/*.ts module that touches Supabase or Google constructs its
// client eagerly at import time via requireEnv() (see lib/env.ts) — with no
// setup, importing almost anything under lib/ or app/ would throw
// "Missing required environment variable" before a single test runs.
// These are dummy, never-dialed values: every test that needs to observe a
// Supabase/Google call mocks the module directly (see tests/mocks/), so
// the real client these values construct is never actually used over the
// network.
process.env.SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.API_SECRET ??= "test-api-secret";
process.env.CRON_SECRET ??= "test-cron-secret";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ??= "test@test.iam.gserviceaccount.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ??= "test-private-key";
process.env.GOOGLE_SHEETS_TEMPLATE_ID ??= "test-template-id";
