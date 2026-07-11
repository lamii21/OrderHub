# Production Deployment Guide

This is the production-readiness reference for OrderHub: what's already in place, what to
configure at deploy time, and what to keep an eye on afterward. It assumes you've already read
the [README](README.md)'s "Deployment Guide" section for the one-time Supabase/Google
Cloud/Vercel setup steps — this document is the deeper checklist for taking that setup to
production traffic.

---

## 1. Security

### Headers

`next.config.ts` sends on every response: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera/microphone/geolocation/FLoC all denied), and
`Strict-Transport-Security: max-age=31536000; includeSubDomains`. HSTS has no effect in local dev
(browsers only honor it over a real HTTPS connection) so it's safe to leave on unconditionally.

### Content-Security-Policy

`proxy.ts` + `lib/csp.ts` generate a fresh nonce per request and send
`Content-Security-Policy-Report-Only` on every HTML-rendering route (API routes/static
assets/the image optimizer are excluded — they don't render HTML, so a CSP there is inert).
Policy: `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'`, `object-src 'none'`,
`frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.

**It ships Report-Only, not enforced.** That's deliberate — a policy this strict can't be fully
verified against real browser behavior without production traffic to observe. To flip it to
enforced once you've watched a deploy or two with no unexpected violations:

1. In `proxy.ts`, change both `Content-Security-Policy-Report-Only` header names to
   `Content-Security-Policy`.
2. If you want to keep observing violations after enforcing, wire a `report-to`/`report-uri`
   directive to a collection endpoint first — none exists today, so violations currently only
   show up in each visitor's own browser console (DevTools → Console → CSP warnings), not
   centrally. This is the honest gap: there's no CSP violation aggregation in this codebase yet.

### Rate limiting

`lib/rate-limit.ts` — in-memory, fixed-window, per-instance. Applied to `/api/orders` (120/min
per IP), `/api/cron/sync` and `/api/cron/automation-retry` (10/min per IP), `/api/health`
(30/min per IP), `/api/metrics` (30/min per IP), and the login Server Action.

**Known limitation, not a bug:** on Vercel's serverless platform, each warm function instance has
its own in-memory Map — this bounds abuse per-instance, not with one global ceiling across every
concurrent instance. Still strictly better than no limit against a single misbehaving caller. If
real abuse under multi-instance load is ever observed, `checkRateLimit()`'s body is a drop-in
swap for a shared store (Redis, or Supabase itself) — no call site would need to change.

### CSRF

Server Actions are Next.js's built-in write path here (not a separate API layer), and Next
enforces Origin/Host header verification on every Server Action POST by default. Verified this
project doesn't weaken it: `next.config.ts` has no
`experimental.serverActions.allowedOrigins` override. The one real API route that accepts
writes from outside the browser (`/api/orders`) is intentionally exempt from CSRF concerns — it's
never called by a browser at all, only by Google Apps Script / platform sync code, and is
protected by its own `x-api-key`/webhook-secret check instead.

### Secrets

`API_SECRET` and `CRON_SECRET` both support zero-downtime rotation via `*_PREVIOUS` variables
(`matchesAnySecret()` in `lib/env.ts`, constant-time comparison). To rotate either:

1. Set `X_SECRET_PREVIOUS` to the current value of `X_SECRET`.
2. Set `X_SECRET` to the new value. Redeploy.
3. Update every external caller (Apps Script deployments, your cron scheduler) to the new value.
4. Once nothing is still sending the old value, remove `X_SECRET_PREVIOUS`.

Nothing else in the codebase holds a long-lived secret outside environment variables — Shopify
credentials are the one exception, stored per-shop in the `shops` table (see README → Security
Notes for the plaintext-at-rest trade-off already documented there; RLS + server-only service-role
access is what protects that table today, not column-level encryption).

### Audit logging

`logger.audit()` (`lib/logger.ts`) writes a structured, JSON, `audit: true` log line for every
security-sensitive action: shop connect/reconnect/delete, spreadsheet regeneration, webhook secret
regeneration, credential changes, workflow activation. Filtering deployment logs on `"audit":true`
reconstructs "who did what, when" without a separate audit table. This is intentionally additive
on top of the ~70 pre-existing `console.error()` call sites, not a wholesale logging migration.

### API validation

- `POST /api/orders` — full payload validation (`lib/validation.ts` → `validateOrderPayload()`):
  type-checks every field, enforces the 6 valid order statuses, caps free-text field lengths.
  Auth via `x-api-key` (global secret or per-shop webhook secret) before the body is even parsed.
- `GET /api/cron/sync`, `GET /api/cron/automation-retry`, `GET /api/metrics` — no request body to
  validate (scheduler/monitor-triggered `GET`s); all three are secret-gated
  (`Authorization: Bearer <CRON_SECRET>`) and rate-limited.
- `GET /api/health` — deliberately unauthenticated (an uptime monitor needs to reach it with no
  secret) but rate-limited, and returns only booleans/counts, nothing sensitive.
- Server Actions validate ids via `parsePositiveInt()` and emails via `isValidEmail()`
  (`lib/validation.ts`); RLS is still the real backstop for "does this id belong to you," not
  application-level validation.

---

## 2. Performance

### Caching

`lib/automation-modules/credentials.ts` has an in-memory, TTL-based cache for per-shop module
credentials (WhatsApp tokens, webhook URLs, etc.) with explicit invalidation
(`invalidateModuleCredentialsCache()`) called on every credential write — avoids a database round
trip on every workflow step execution without risking a stale read after a credential change.
Nothing else in the app caches: every dashboard/analytics/products page reads fresh on every
request (`export const revalidate = 0`), which is the right default for an order-management tool
where "is this order's status current" matters more than shaving a query.

### Pagination

- `/dashboard` (orders) and `/products` both paginate at 25 rows/page (`.range()` + an exact
  `count`, "Page X of Y" controls) — the two lists that can realistically grow into the thousands
  per shop.
- `/admin`'s list-style sections (Recent Activity, Error Center, etc.) cap at 10–15 rows by
  `.limit()` instead of paginating — they're glance-at summaries, not full listings, by design.
- `/shops` is **not** paginated. Documented, not fixed: it's RLS-scoped to one user's own
  connected shops, which realistically stays in the tens, not thousands — revisit only if a real
  merchant's shop count grows unexpectedly large.

### Indexes & query optimization

Every foreign key and every column used in a `.eq()`/`.gte()`/`.order()` hot path has a matching
index in `supabase/schema.sql`: `orders(shop_id)`, `orders(created_at desc)`,
`orders(shop_id, product)`, `products(shop_id)`, `sync_history(shop_id)`,
`sync_history(started_at desc)`, `workflow_executions(workflow_id)`,
`workflow_executions(order_id)`, `workflow_executions(status, started_at desc)`,
`shops(user_id)` (added specifically because every RLS policy filters/subqueries on it — without
it, every request was a sequential scan of the whole `shops` table), `module_credentials(shop_id,
module_name)` (unique, doubles as the cache key above). All aggregation (dashboard KPIs, product
stats, sync/workflow performance) happens in SQL via Postgres functions (`get_*_with_stats`,
`get_*_performance_stats`), called with `.rpc()` — no page pulls every row into JavaScript to
compute a count or sum.

### Bundle size

Recharts (the only sizeable client-side dependency) is only imported by `app/admin/page.tsx` and
`app/analytics/page.tsx` — Next's App Router code-splits per route by default, so its weight never
loads on `/dashboard`, `/products`, `/shops`, or `/login`. No further bundle work (dynamic
`import()`, `next/image`) was needed at this project's current scale: there are no large images in
the app, and no other dependency large enough to be worth deferring.

---

## 3. Monitoring

### Structured logging

`lib/logger.ts` — every log line is a single JSON object (`timestamp`, `level`, `event`, plus
arbitrary fields) via `console.*`, so it's greppable/parseable by whatever the deployment
target's log aggregation already does (Vercel's own log drains, or any external one piped from
there). Not a new logging service — deliberately.

### Error tracking hook

`setErrorReporter()` (`lib/logger.ts`) lets a deployment wire every `logger.error()` call to an
external tracker (Sentry, Bugsnag, whatever's already paid for) without this project taking on
that dependency itself. Disabled by default (a no-op). To enable Sentry, see the commented example
in `instrumentation.ts` — `npm install @sentry/nextjs`, initialize it, then one `setErrorReporter`
call. Not wired to `logger.warn()` on purpose: warnings are routine (a rate limit hit, a stale
cache entry), not error-tracker-worthy.

### Metrics

`GET /api/metrics` — a machine-to-machine JSON snapshot for an external monitor/dashboard to poll
periodically (Grafana agent, a scheduled Slack digest, a cron-based scraper). Same
`Authorization: Bearer <CRON_SECRET>` auth as the cron routes (no new secret to provision), rate
limited at 30/min. Returns global counts (not per-user RLS-scoped): total shops, total orders,
orders in the last 24h, sync attempt count + success rate in the last 24h, workflow execution
attempt count + success rate in the last 24h. Deliberately plain JSON, not a Prometheus text
endpoint or a new metrics-store dependency — consistent with this project's "no new infrastructure
by default" posture. Wrap this response from a real APM/scraper if one is ever added.

### Health checks

`GET /api/health` — unauthenticated (so a load balancer or uptime monitor can reach it without a
secret), rate-limited, checks real database connectivity (a `count`-only query against `shops`)
and required-env completeness. Returns `200` + `"status": "ok"` or `503` + `"status": "degraded"`
with which specific check failed. Point Vercel's own monitoring, or any external uptime service
(UptimeRobot, Better Uptime, Pingdom, ...), at this URL.

---

## 4. Deployment

### Vercel configuration

- **Cron Jobs**: `vercel.json` already defines both crons:
  - `/api/cron/sync` — hourly (`0 * * * *`)
  - `/api/cron/automation-retry` — every 5 minutes (`*/5 * * * *`)

  Vercel automatically injects `Authorization: Bearer <CRON_SECRET>` for any env var named
  exactly `CRON_SECRET` on a Vercel Cron Job — no manual header configuration needed on Vercel
  itself. If you ever trigger these from a different scheduler (GitHub Actions, an external cron
  service) instead of/in addition to Vercel Cron, that caller must send the header explicitly.
- **Function duration**: both cron routes set `export const maxDuration = 300` (5 minutes) —
  requires at least a Pro plan; Hobby caps at 60s regardless of what the code requests. Verify
  your Vercel plan supports this before relying on a run processing its full per-run cap
  (`MAX_SHOPS_PER_RUN = 60` shops, `MAX_WAITS_PER_RUN = 50` workflow resumes).
- **Environment Variables**: set every variable in `.env.local.example` under Vercel's
  **Production** scope (Project Settings → Environment Variables). Set `*_PREVIOUS` variables only
  during an active secret rotation (see Security → Secrets above) — remove them once rotation
  completes.
- **Node.js version**: this project requires Node.js **20.9+** (Next.js 16's own minimum). Vercel
  picks a compatible runtime automatically for a fresh import; if a project was created before
  this requirement existed, check Project Settings → General → Node.js Version.

### Supabase production configuration

- **Connection**: this app talks to Supabase entirely over its REST API (via
  `@supabase/supabase-js`), never a direct Postgres connection — there's no connection-pooler
  (PgBouncer/Supavisor) configuration needed on the app side.
- **Compute add-on**: Supabase's free-tier project pauses after a week of inactivity and has
  limited compute — fine for development, not for production traffic on a schedule (the hourly
  sync cron would silently start failing against a paused project). Upgrade to at least a **Pro**
  plan before pointing real cron traffic at a project.
- **RLS**: already enabled on every user-facing table (`shops`, `orders`, `products`, plus the
  Workflow Engine tables) — this is what actually enforces per-user data isolation, not
  application code. Before going live, run Supabase's own **Advisors** (Database → Advisors, or
  the `get_advisors` check if using the Supabase MCP tools) to catch any table that ended up
  without a policy.
- **Service role key**: `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely and must only ever exist
  as a server-side environment variable — never in a "use client" component, never logged. It
  already isn't (verified: every `lib/supabase.ts` import site is server-only code).
- **Custom domain / SMTP** (if using Supabase Auth's email features beyond what this app uses
  today — it currently has no sign-up/password-reset flow, so this is forward-looking): configure
  a custom SMTP provider under Authentication → Email Templates before relying on Supabase's
  shared, rate-limited default sender for anything user-facing.

### Cron verification

After deploying, confirm both crons are actually wired up and firing:

1. Vercel dashboard → your project → **Cron Jobs** tab — confirms Vercel registered both jobs from
   `vercel.json` and shows their last-run status/timestamp.
2. Manually trigger each once to verify auth and behavior before waiting for the schedule:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/sync
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/automation-retry
   ```
   Both return a JSON summary (`checked`/`due`/`synced`/`deferred` for sync;
   `waits`/`retries` for automation-retry) — a `401` here means `CRON_SECRET` isn't set the same
   way in Vercel as in the curl command; a `500` means check the deployment's logs for the
   underlying Supabase error.
3. Watch `logger.warn("cron.backlog", ...)` / `logger.warn("cron.automation_retry.resume_backlog",
   ...)` in your logs after the first few real runs — either means the per-run cap
   (`MAX_SHOPS_PER_RUN`/`MAX_WAITS_PER_RUN`) is being hit regularly, a signal it may need raising
   (alongside `maxDuration` and your Vercel plan) as usage grows.

### Environment validation

`instrumentation.ts` runs `validateEnvironment()` (`lib/env-validation.ts`) once at server
startup, before any request is handled. It logs (never throws — a serverless platform has no
clean way to abort startup) which **core** vars are missing (`startup.env_validation_failed`,
error level — nothing works without these: both Supabase keys, `API_SECRET`, `CRON_SECRET`) versus
**optional** ones (`startup.env_optional_missing`, warn level — the 3 Google service account vars;
their absence only disables Sheet auto-provisioning, not the rest of the app). Check your
deployment's boot logs for either of these events right after the first deploy, and again after
any environment variable change, rather than waiting to discover a missing var from a user-facing
500 later. `GET /api/health`'s `checks.environment` field surfaces the same core-var check
continuously, for an uptime monitor to catch a var that gets accidentally removed post-deploy.

### Backup recommendations

Supabase's free tier has **no automatic backups**. Before going live with real merchant data:

1. **Enable Point-in-Time Recovery (PITR)** — requires a Pro plan or above (Database → Backups in
   the Supabase dashboard). This is the primary recommendation: it allows restoring to any point
   within the retention window, not just a daily snapshot, which matters for recovering from a bad
   deploy or an accidental bulk delete/update.
2. **If staying on a lower tier**, at minimum schedule a periodic `pg_dump` yourself (e.g. a
   GitHub Actions cron hitting Supabase's connection string, or the Supabase CLI's
   `supabase db dump`) and store the output somewhere durable (S3, a private repo's release
   assets) — this project has no built-in export/dump tooling of its own, so this is an external,
   infrastructure-level step, not a code change.
3. **`supabase/schema.sql` is already your schema backup** — it's written to be safe to re-run
   (`if not exists`/`create or replace` throughout) and is the single source of truth for the
   schema, checked into version control. A full disaster recovery is: new Supabase project → run
   `schema.sql` → restore data from the most recent `pg_dump`/PITR snapshot.
4. **Before any destructive migration** (a column drop, a data backfill script), take a manual
   snapshot first (Database → Backups → "Create backup now" on Pro+, or a one-off `pg_dump`) even
   if PITR is already enabled — faster to restore from a known-good point than to reason through a
   PITR replay under pressure.

---

## Summary: what's new in this pass

Everything above that wasn't already true of the codebase before this production-readiness pass:

- CSP (nonce-based, Report-Only) via `proxy.ts` + `lib/csp.ts`
- `Strict-Transport-Security` header
- `setErrorReporter()` pluggable error-tracking hook in `lib/logger.ts`
- Audit logging for shop connect/reconnect and spreadsheet regeneration
- Pagination for `/products` (mirroring `/dashboard`'s existing pattern)
- `GET /api/metrics` operational snapshot endpoint
- This document

Everything else referenced above (rate limiting, CSRF protection, secret rotation, `/api/orders`
validation, caching, indexes, health checks, `vercel.json` cron config, structured logging) was
already in place and is documented here for completeness, not because it changed in this pass.
