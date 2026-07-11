import { vi } from "vitest";

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

// lib/net-guard.ts's assertPublicHttpUrl() does a real DNS lookup for any
// URL that isn't a literal IP — every platform-connector and webhook/
// delivery-module test uses ordinary hostnames (example.com,
// acme.myshopify.com, ...), so without this mock every one of those tests
// would make a real, slow, network-dependent DNS query. Defaults to a safe
// "public" resolution (203.0.113.10 is from RFC 5737's TEST-NET-3 range,
// reserved for documentation/testing, and is not in any private range
// lib/net-guard.ts blocks) so existing tests behave exactly as if the URL
// were genuinely public. Tests that specifically exercise the SSRF guard
// override this per-test with vi.mocked(lookup).mockResolvedValueOnce(...).
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "203.0.113.10", family: 4 }]),
}));
