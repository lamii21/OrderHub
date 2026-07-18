# OrderHub

An order-management platform for merchants selling through Shopify, WooCommerce, YouCan, or plain
Google Sheets. Every order flows into one place, where a merchant can track it, and optionally
attach a no-code **Workflow** that automates what happens next (a WhatsApp message, an email, a
CRM/ERP webhook, a Google Sheet export, and 12 other step types) whenever an order is created,
its status changes, or it's cancelled. Built as an internship project, deliberately kept as simple
as the requirements allow at the code level (no Clean Architecture, no repository pattern, no
microservices) even as the feature set grew — see **Project Architecture** below for how that's
still true.

## Stack

- **Next.js (App Router)** + **TypeScript**
- **Tailwind CSS**
- **Supabase** (Postgres + REST API + Auth). Most reads/writes go through the logged-in user's own
  session so **Row Level Security** enforces data isolation (see Authentication below); a small,
  named set of flows with no logged-in user (the webhook, the Google OAuth callback, scheduled
  platform sync) use the service-role key instead.
- **Recharts** (analytics charts)
- **googleapis** (Google Drive/Sheets API via per-user OAuth — spreadsheet provisioning; see
  Authentication below)
- Plain `fetch()` against each platform's REST API (no SDK) — Shopify, WooCommerce, and YouCan are
  all supported via a small connector registry (`lib/platforms/`, see Project Architecture below)
- A hand-rolled **Workflow Engine** (`lib/workflows/`) — no third-party automation/rules-engine
  library — that runs a merchant's configured steps in order against real external services
  (WhatsApp, email, SMS, Slack, CRM/ERP webhooks, etc.), with retry, pause/resume, and a circuit
  breaker; see Project Architecture below
- **Vitest** — the test suite (`tests/`), run via `npx vitest run`

## How it works (the core pipeline)

```
Google Sheets → Google Apps Script → POST /api/orders → Supabase ──┬─→ Dashboard / Analytics / Admin
                                                                     └─→ Workflow Engine (automations)
```

Every order, regardless of where it originates, ends up as a row in a merchant's Google Sheet.
A bound Apps Script reads new rows and POSTs them to `/api/orders`, which is the **only** way
data enters Supabase from the outside. This holds even for the Shopify/WooCommerce/YouCan
integrations: platform order sync writes new orders into the shop's Google Sheet (not into
Supabase directly), so the exact same webhook — unmodified — is what ultimately persists them. See
**Project Architecture** below for why this matters.

Once an order lands in Supabase, `/api/orders` fires an `order.created` event (a status change
from the Dashboard fires `order.status_changed`/`order.cancelled` the same way) into the
**Workflow Engine**, which runs any of that shop's active workflows matching the event — see
**Workflow Engine** in Project Architecture below.

---

## Installation Guide

### Prerequisites

- Node.js 18+ and npm
- A Supabase account (free tier is enough)
- A Google Cloud account (for the Sheets/Drive provisioning feature — optional, see below)
- A Shopify, WooCommerce, or YouCan store with API access (for platform sync — optional, see below;
  not needed for a Google Sheets–only shop)

### Steps

```bash
npm install
cp .env.local.example .env.local
# fill in .env.local — see "Environment Variables" below
```

Then apply the database schema: open your Supabase project's **SQL Editor** and run the entire
contents of [`supabase/schema.sql`](supabase/schema.sql). It's written to be safe to re-run (uses
`if not exists` / `create or replace` throughout), so re-applying it after a schema change is
always the right move — there's no separate migration tool.

```bash
npm run dev
```

Visit `http://localhost:3000` — it redirects to `/dashboard`.

---

## Environment Variables

All required variables are listed in [`.env.local.example`](.env.local.example). None of these
are ever sent to the browser — every one is read only in Server Components, Server Actions, or
the API route.

| Variable | Required for | Where to get it |
|---|---|---|
| `SUPABASE_URL` | Everything | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | The webhook, the Google OAuth callback, scheduled platform sync — the flows with no logged-in user session (see Authentication below) | Supabase → Project Settings → API (the **secret** `service_role`/`sb_secret_...` key — never the `anon`/publishable one) |
| `SUPABASE_ANON_KEY` | Login, every protected page, RLS-scoped queries | Supabase → Project Settings → API (the public `anon`/publishable key — safe by design, but used here server-only; see Authentication below) |
| `API_SECRET` | The `/api/orders` webhook | Any value you generate yourself; it's the shared secret your Apps Script sends in the `x-api-key` header |
| `CRON_SECRET` | The scheduled sync (`/api/cron/sync`), the automation retry sweep (`/api/cron/automation-retry`), and the metrics endpoint (`/api/metrics`) | Any value you generate yourself. On Vercel, an env var named exactly `CRON_SECRET` is auto-sent as `Authorization: Bearer <value>` by Vercel Cron Jobs; any other scheduler must send it explicitly |
| `API_SECRET_PREVIOUS` / `CRON_SECRET_PREVIOUS` | Optional — rotating either secret without an instant cutover | Set to the *old* value while every caller (Apps Script deployments, the scheduler) is updated to the new one, then remove it |
| `GOOGLE_OAUTH_CLIENT_ID` | Connecting a Google account (`/api/google/connect`) | Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same as above | Same OAuth client |
| `GOOGLE_OAUTH_REDIRECT_URI` | Same as above | Must exactly match a redirect URI registered on that OAuth client, e.g. `https://your-domain.com/api/google/callback` |
| `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` | Same as above | Generate yourself: `openssl rand -base64 32`. Encrypts stored refresh tokens at rest — rotating it invalidates every connected account |
| `GOOGLE_SHEETS_TEMPLATE_ID` | Optional — a starting template for provisioned spreadsheets | The file ID (from its URL) of your template spreadsheet — see Deployment Guide. If unset, a blank Orders+Config spreadsheet is created from scratch per shop |

The app fails fast with a clear error naming the exact missing variable ([`lib/env.ts`](lib/env.ts))
rather than failing later with a cryptic error from inside Supabase/Google's client libraries.
Core variables (Supabase, `API_SECRET`) are validated the moment their route/page is used; Google
credentials are validated lazily inside the Google OAuth/Sheets functions specifically so that an
unconfigured Google integration never breaks the rest of the app (dashboard, analytics, products,
and even shop creation itself all work fine without it — see Authentication below).

Shopify/WooCommerce/YouCan credentials are **not** environment variables — they're entered
per-shop through `/shops/connect` and stored in the `shops` table as plain columns, protected by
RLS (not encrypted at rest — see Security Notes below for that trade-off).

---

## Local Development Guide

- `npm run dev` — start the dev server (Turbopack).
- `npm run build` / `npm run start` — production build and run it locally.
- `npx vitest run` — run the test suite (`tests/`: unit tests for `lib/`, Server Action tests with
  a hand-built chainable Supabase mock, webhook/route tests, workflow engine tests). `npx vitest`
  for watch mode.
- No linter is configured beyond `tsc --noEmit`; run that directly to typecheck: `npx tsc --noEmit`.
- Database changes: edit `supabase/schema.sql` directly (it's the single source of truth for the
  schema) and run the new statements in the Supabase SQL Editor. There is no separate migrations
  folder — this app is small enough that one idempotent file is simpler to maintain correctly.
- Testing the Google Sheets webhook locally: Google's servers can't reach `localhost`. Either
  deploy first, or temporarily tunnel your local server (e.g. `ngrok http 3000`) and point the
  Apps Script's `API_URL` at the tunnel URL.
- Testing Shopify sync locally works fine as-is — those calls go from your machine to Shopify's
  API directly, no tunnel needed.

---

## Deployment Guide (Vercel + Supabase + Google Cloud)

### 1. Supabase

1. Create a project at supabase.com.
2. SQL Editor → run all of `supabase/schema.sql`.
3. Project Settings → API → copy the Project URL and the `service_role` secret key.

### 2. Google Cloud (only needed for Google Sheet auto-provisioning)

1. Create/select a project at console.cloud.google.com, enable the **Google Drive API** and
   **Google Sheets API**.
2. APIs & Services → **OAuth consent screen** — configure it (External is fine for most cases).
   The scopes this app requests (`drive.file`, `spreadsheets`, `openid`, `email`) are narrow enough
   to typically avoid Google's stricter verification review, but confirm this on your own consent
   screen before relying on it in production.
3. APIs & Services → **Credentials** → **Create Credentials → OAuth client ID** → Application type
   **Web application**. Add an authorized redirect URI matching exactly where you'll deploy:
   `https://your-domain.com/api/google/callback` (and `http://localhost:3000/api/google/callback`
   for local dev, as a second entry). Save the **Client ID** and **Client Secret**.
4. Generate an encryption key for stored refresh tokens: `openssl rand -base64 32`.
5. (Optional) Build a template spreadsheet, if you want every shop to start from a shared layout
   instead of a blank one:
   - Two tabs: **Orders** (columns A–H exactly matching `apps-script/sync-orders.gs`'s `COL`
     layout) and **Config** (`B1` = shop name, `B2` = platform, both left blank).
   - `Extensions → Apps Script`, paste `apps-script/sync-orders.gs`, fill in `API_URL` (your
     deployed `/api/orders` URL) and `API_SECRET` (must match the Vercel env var) once — this is
     shared by every shop copied from this template.
   - Share it with whichever Google account you'll use to test provisioning, as at least
     **Viewer** — no service account to share with anymore, since each user provisions with their
     own connected account.
   - Copy the template's file ID from its URL into `GOOGLE_SHEETS_TEMPLATE_ID`. Leave it unset to
     have a blank Orders+Config spreadsheet created from scratch per shop instead.

### 3. Vercel

1. Import the repo, set the **Environment Variables** from the table above (Production scope).
2. Deploy.
3. Update the Apps Script template's `API_URL` to the real deployed URL if you used a placeholder
   or tunnel earlier.

Two scheduled jobs are already defined in [`vercel.json`](vercel.json) and start running
automatically once deployed to Vercel — no separate setup step needed there, only `CRON_SECRET`
(above) being set:

| Schedule | Route | What it does |
|---|---|---|
| Every hour | `/api/cron/sync` | Syncs products/orders for every shop whose sync frequency is due (bounded concurrency — see Project Architecture) |
| Every 5 minutes | `/api/cron/automation-retry` | Resumes any paused workflow (the Delay module) whose wait is due, and retries workflow steps that failed and are within their backoff window |

If deploying anywhere other than Vercel, these two routes need to be triggered by an external
scheduler (e.g. a GitHub Actions cron, or any HTTP-capable scheduler) sending
`Authorization: Bearer <CRON_SECRET>` on the same schedule.

### 4. Platform credentials (only needed if connecting a real store)

Entered per-shop through the `/shops/connect` form at runtime — no deploy-time setup or env vars
for any of the three:

- **Shopify** — Store admin → **Settings → Apps and sales channels → Develop apps → Create an
  app**, grant `read_products`/`read_orders` Admin API scopes, install it, and copy the Admin API
  access token into the form's API Key field. Sent as an `X-Shopify-Access-Token` header.
- **WooCommerce** — Store admin → **WooCommerce → Settings → Advanced → REST API → Add key**, with
  Read permissions. Copy the Consumer Key into the API Key field and the Consumer Secret into the
  API Secret field (the only one of the three platforms that uses both). Sent as query parameters,
  not headers.
- **YouCan** — an API key from the store's developer settings, sent as an `Authorization: Bearer`
  header. This connector's request shapes are a best-effort implementation based on YouCan's
  general API conventions, not yet cross-checked against a live store the way Shopify/WooCommerce
  have been — worth verifying against a real YouCan store before relying on it (`lib/platforms/youcan.ts`
  documents exactly which assumptions to check first).

---

## Project Architecture

Deliberately flat — no layers, no dependency injection, no domain/service/repository split:

- **`app/*/page.tsx`** — Server Components. Fetch data directly from Supabase (or call another
  server function) and render. This is the entire "backend" for reads.
- **`app/*/actions.ts`** — Server Actions (`"use server"`). Every write (status update, shop
  creation, Shopify sync) is a plain async function called directly from a `<form action={...}>`
  or from a Client Component via `useTransition`. No API routes for internal writes — the one
  real API route (`/api/orders`) exists only because it must be reachable from Google's servers,
  not from this app's own UI.
- **`lib/*.ts`** — one small file per external service (`supabase.ts`, `google-sheets.ts`), each
  exporting a couple of plain functions. Not classes, not repositories. Two of these are Supabase
  clients with deliberately different privilege levels — see Authentication.
- **`lib/platforms/`** — the multi-platform connector registry (Shopify/WooCommerce/YouCan) behind
  a single `PlatformConnector` interface, replacing the original Shopify-only `lib/shopify.ts` —
  see Project Architecture → Platform rate-limit retries above.
- **`lib/workflows/`** — the Workflow Engine:
  - `manager.ts` resolves which of a shop's *active* workflows match an event (`order.created`,
    `order.status_changed`, or `order.cancelled`), with a short in-memory cache.
  - `engine.ts` (`runWorkflow`/`runSteps`) runs a matched workflow's steps in the order the
    merchant configured (`step_order`), one try/catch per step. A step's own failure does **not**
    stop the run — the next step still executes — unless the step's result explicitly says
    `outcome: "stop"` (e.g. the Condition module evaluating false) or `outcome: "waiting"` (the
    Delay module). A shared `WorkflowContext` object carries each step's `data` output forward, so
    a later step can read what an earlier one produced in the same run.
  - `circuit-breaker.ts` skips (without calling it) any step that has failed its last 3 consecutive
    attempts, recording why, instead of repeating a call to a dead integration.
  - `resume.ts` + `retry.ts`, driven by the `/api/cron/automation-retry` job (every 5 minutes — see
    Deployment Guide): `resume.ts` persists a `workflow_waits` row when a step returns
    `outcome: "waiting"` and resumes the run (with its original context restored) once due;
    `retry.ts` re-attempts steps that failed and are still within their backoff window.
  - `dispatch.ts` (`handleEvent`) is the single entry point both the webhook and
    `updateOrderStatus` call to trigger a workflow run for an event.
  - `execution-history.ts` records one row per step *attempt* (success or failure, with a message
    and duration) into `workflow_executions` — this is what backs both the Workflow Builder's
    execution history and the "Automation" section on an order's own detail page
    (`app/orders/[id]/page.tsx`).

  `app/shops/[id]/workflows/` is the Builder UI + Server Actions — create/edit a workflow, choose
  its trigger, add/edit/remove/reorder steps (move-up/move-down, not drag-and-drop), activate (only
  once the workflow has a valid trigger and at least one step with valid config)/deactivate, and
  "Test Workflow Now" (runs the exact same `runWorkflow()` the production engine uses, against the
  shop's most recent order, even while the workflow is still a draft).

- **`lib/automation-modules/`** — 16 step types a workflow can run, each implementing the same
  small `run()`/`validateConfig()` contract (`types.ts`) so the engine never special-cases a
  particular module. All 16 do real work (an outbound API call or a real database write), none are
  placeholders:

  | Module | What `run()` does |
  |---|---|
  | WhatsApp | Sends a message via the WhatsApp Cloud API |
  | AI Agent | Calls the Anthropic Messages API with the order as context; can stop the workflow below a confidence threshold |
  | Delivery Company | Posts the order's shipping info to a configured carrier webhook |
  | Email | Sends an email via the Resend API |
  | SMS | Sends a text message via the Twilio API |
  | Slack | Posts a message to a Slack incoming webhook |
  | CRM / ERP | Posts the order to a configured external endpoint |
  | Google Sheets | Appends a row to a merchant-chosen spreadsheet/tab (distinct from the shop's own provisioned sheet) |
  | Webhook | Sends the order (and shop) as JSON to any configured URL |
  | Tag Order | Adds tags to the order |
  | Update Status | Changes the order's status (does not re-trigger `order.status_changed`, to avoid recursion) |
  | Archive | Sets the order's `archived_at` timestamp |
  | Notes | Adds a note to the order (`order_notes`) |
  | Condition | Compares an order field against a value; stops the run if false |
  | Delay | Pauses the run for a configured duration, resumed later by the cron (see above) |

  Every outbound URL a module or connector calls (Webhook, Slack, CRM, ERP, Delivery) goes through
  `lib/net-guard.ts`'s SSRF check first — see Security Notes.

- **`app/admin/`** — the Admin & Monitoring Center, open to any logged-in user (not a separate
  privilege tier — RLS still scopes everything shown to that user's own shops, same as every other
  page): per-shop sync status and next-due time, an unbounded "Error Center" of recent sync
  failures, a "Recent Activity" log, aggregate performance stats (`get_sync_performance_stats()`),
  and manual actions — run a sync now, test every shop's connection, retry failed workflow
  executions.
- **Client Components** exist only where interaction requires them: the status dropdown, the
  order/product details modal, and the `SubmitButton`/`useFormStatus` loading indicator. Every
  other component is a Server Component.
- **Supabase Postgres functions** (`get_dashboard_stats`, `get_products_with_stats`,
  `get_shops_with_stats`, `get_workflows_with_stats`, etc.) do all aggregation in SQL, called via
  `.rpc()`. No stats are computed by pulling every row into JavaScript.

### Why Shopify sync doesn't write to Supabase

The explicit design constraint from day one was: **Google Sheets is the single ingestion
pipeline.** So when a Shopify-connected shop needs its orders synced, the sync action
(`app/shops/connect/actions.ts` → `syncOrders`) fetches new Shopify orders and appends them as
rows into that shop's Google Sheet via the Sheets API — using the exact same "Orders" tab and
column layout the bound Apps Script already reads. The Apps Script (next time it runs) then sends
those rows to `/api/orders`, completely unaware of whether a human typed them in or a sync action
wrote them. Nothing about the webhook changed to support this.

### Data model

- `orders.shop_id` **is** a real foreign key (set by the webhook via `shops.sheet_id` upsert).
- `orders.product_id` **is** also a real foreign key to `products(id)`, resolved once at write time
  (`/api/orders` looks up the matching product by `(shop_id, name)` and stores its id) so an
  order's product stats stay correctly linked even if that product is later renamed.
- The free-text match this replaced — `(orders.shop_id = products.shop_id AND orders.product =
  products.name)` — is kept as a fallback inside `get_products_with_stats()`/`get_product_stats()`
  purely for rows written before `product_id` existed. Once every shop has synced at least once
  since that column was added, this fallback has nothing left to match against.

---

## Reliability & Data Integrity (Hardening Phase)

A follow-up pass addressed the highest-impact issues from an architecture audit, without changing
the architecture itself. No new pages, no auth, no UI redesign — just correctness.

### Duplicate order protection

`orders` now has a unique index on `(shop_id, order_id)` (`supabase/schema.sql`), and
`POST /api/orders` upserts on that pair instead of always inserting. Receiving the same order
twice (a retried webhook call, a Google Sheets row resent after a network error) updates the
existing row instead of creating a duplicate.

Two details worth knowing:
- **`order_id` is optional.** Postgres treats every `NULL` in a unique index as distinct from every
  other `NULL`, so two orders with the same `shop_id` but no `order_id` are never considered
  duplicates of each other. Today's Google Sheets → Apps Script flow doesn't send `order_id` at
  all, so this protection is fully active only once a caller actually supplies a stable ID (e.g. a
  future direct Shopify order sync into Supabase). It's already active for any payload that does
  send one.
- **`status` is excluded from the upsert unless the caller explicitly sends it.** If it were always
  included, a duplicate delivery would silently reset a merchant's manually-changed status (e.g.
  "Shipped") back to `pending` on every resend. Left out, the column's own default handles new
  rows and an existing row's status is simply never touched by a duplicate.

### Webhook payload validation

`lib/validation.ts` → `validateOrderPayload()` checks, with plain `typeof`/`Number` logic (no
validation library): `customer_name` and `product` are strings, `quantity` is a positive number,
`price` is a finite number, and `status` — if present — is one of the six valid values
(`ORDER_STATUSES`, also exported from the same file and now used by the dashboard's status-update
action too, so there's exactly one list instead of two that could drift). Any failure returns
`400` with a plain-English reason before anything touches the database.

### Database integrity

Three additions in `supabase/schema.sql`, all written to be safe to re-run:
- `orders_status_check` — a `CHECK` constraint enforcing the same six statuses at the database
  layer, so a bug in any *future* write path (not just the webhook) can't insert an invalid value.
- `orders_shop_order_unique` — the unique index backing the upsert above.
- `products_shop_name_unique` — prevents two products in the same shop sharing a name, which
  previously let `get_products_with_stats()`'s join fan out and double-count that product's orders.

### Shopify incremental sync cursor

`shops.last_synced_at` no longer gets set to `new Date()` (wall-clock time when the sync
action finishes). It's now set to the **newest `created_at` Shopify actually returned**, advanced
by one second. Two reasons for the adjustment:
- Using wall-clock time left a gap: any order created between the fetch and the cursor write would
  fall after the new cursor without ever having been included in a fetched batch — silently lost
  forever.
- Shopify's `created_at_min` filter is inclusive, so using the newest order's exact timestamp as
  the next cursor would refetch (and re-append to the Sheet) that same order every run. The
  one-second advance avoids that.

If Shopify returns no new orders, the cursor is left completely unchanged — there's nothing to
advance it to, and touching it wouldn't be safe.

### Platform rate-limit retries

Shopify has since been generalized into `lib/platforms/` — a small connector registry
(`index.ts` → `getConnector(platform)`) with one file per platform (`shopify.ts`,
`woocommerce.ts`, `youcan.ts`), each implementing the same `PlatformConnector` interface
(`types.ts`: `testConnection`/`fetchProducts`/`fetchOrders`). The `HTTP 429` retry loop described
in this section originally lived only in `lib/shopify.ts`; it's now `lib/platforms/retry.ts`,
shared by every connector: on `429`, it reads the `Retry-After` header, waits that many seconds,
and retries — up to 3 times. If a platform is still rate-limiting after the third retry, it
throws, which the calling code turns into the existing friendly "could not sync" message. No
library — just a loop and `setTimeout`.

### One shop-creation helper

`lib/shop.ts` → `createOrUpdateShop()` is now the only code that writes to the `shops` table. It
replaces three previously-separate implementations (the webhook, `/shops/new`, `/shops/connect`)
that had already started to drift from each other. It's a single exported function — no class, no
repository pattern — that upserts on `sheet_id` and accepts the Shopify fields as optional
parameters so the two non-Shopify call sites don't need to pass them.

---

## Authentication & Security Architecture

Logging into OrderHub itself is email + password only (Supabase Auth) — no magic links, no
roles/permission levels. Every user sees only the shops, orders, and products they created. Google
OAuth exists in this app, but it is a *separate, later* connection a logged-in user makes to grant
Drive/Sheets access — never a way to log into OrderHub itself; see **Google OAuth is not a login
system** below. The Admin Center (`/admin`) is not a separate privilege tier either — any logged-in
user can open it, and RLS scopes what it shows to that user's own shops (see **Admin Center**
below).

### Authentication flow

1. `/login` is a Server Component form (`app/login/page.tsx`) posting to a Server Action,
   `login()` (`app/login/actions.ts`). No client-side auth logic anywhere.
2. `login()` calls `supabase.auth.signInWithPassword({ email, password })` using a
   **cookie-bound** Supabase client (`lib/supabase-server.ts`). On success, Supabase Auth writes
   the session into cookies and the action redirects to `/dashboard`; on failure, it redirects
   back to `/login?error=...` with a generic "Invalid email or password" (never revealing whether
   the email exists).
3. `logout()`, right next to `login()` in the same file, calls `supabase.auth.signOut()` and
   redirects to `/login`. It's wired to a plain `<form action={logout}>` in the nav bar
   (`app/layout.tsx`) — a Server Action, not a client click handler.
4. There is no separate sign-up page — accounts are created directly in the Supabase dashboard
   (Authentication → Users → Add user), consistent with "no invitation system, no roles."

### Protected routes

`proxy.ts` (Next's current name for what used to be called middleware — this project was built
across that rename) runs `lib/supabase-middleware.ts`'s `updateSession()` on every request under
`/dashboard`, `/analytics`, `/products`, `/orders`, `/shops` (covers `/shops`, `/shops/[id]`,
`/shops/new`, and `/shops/connect`), `/workflows`, and `/admin`. It checks
`supabase.auth.getUser()`; if there's no user, it redirects to `/login` before the page ever
renders. The `/api/*` routes are intentionally **not** in this matcher — each has its own,
separate secret check (`x-api-key` for the webhook, `Authorization: Bearer <CRON_SECRET>` for the
cron/metrics routes), since none of their callers (Google's servers, a scheduler, an external
monitor) can sign in with a Supabase session.

### Row Level Security

This is what actually enforces "you only see your own data," not application code. Every
user-facing table has RLS enabled (`supabase/schema.sql`), scoped to `auth.uid()` through a real
ownership chain — `shops`/`workflows` filter on their own `user_id`/`shop_id` directly; child
tables (`orders`, `products`, `sync_history`, `module_credentials`, `workflow_steps`) filter via
`shop_id in (select id from shops where user_id = auth.uid())`; grandchild tables (`order_history`,
`order_notes`, `workflow_executions`, `workflow_waits`) chain one level further through their
parent row. `google_accounts` is scoped directly on its own `user_id`. A dedicated test suite
(`tests/rls/schema-policies.test.ts`) statically parses `supabase/schema.sql` and asserts every one
of these policies exists, is enabled, and never falls back to an unconditional `using (true)` — it
verifies the policies are shaped correctly, not that Postgres enforces them at runtime (that would
need a live local Supabase instance, not part of this test suite).

Because every dashboard/analytics/products/admin query already went through Postgres functions
(`get_dashboard_stats`, `get_products_with_stats`, `get_shops_with_stats`,
`get_workflows_with_stats`, etc.) instead of raw table selects, and those functions are
`security invoker` (the default — they run as whichever role called them), simply switching the
*caller* from the service-role key to the logged-in user's own session makes every existing
aggregate correctly scoped to that user's shops, admin pages included. **None of the SQL function
bodies changed.** There's no `shop_id` filter to write anywhere in application code, because RLS
already restricted what the underlying tables return before the aggregate ever ran.

### Why the service role is still required

Three flows have no logged-in user in the request at all, so there's nothing for RLS to check
`auth.uid()` against — they keep using `lib/supabase.ts` (the service-role client, bypasses RLS):

- **The webhook** (`/api/orders`) — called by Google Apps Script, an external system with no
  Supabase session.
- **The Google OAuth callback** (`/api/google/callback`) — a redirect landing from google.com, not
  a same-origin form submission with the user's session cookie guaranteed to survive the hop. It
  identifies the user via a signed, self-contained state token instead (`lib/google-oauth.ts`'s
  `buildStateToken`/`verifyStateToken`) and writes the connection to `google_accounts` via the
  service-role client. `google_accounts` still has its own RLS policies scoped to
  `user_id = auth.uid()` (see `supabase/schema.sql`), for any future user-facing read that goes
  through the RLS-scoped client instead.
- **Platform sync** (`syncProducts`/`syncOrders` in `app/shops/connect/actions.ts`, same for the
  hourly cron) — reads a shop's stored platform credentials and calls its connector
  (`lib/platforms/`) to fetch/upsert products or append orders to the Sheet, using the service role
  rather than threading a per-request user session through the connector.

The last one still needed a manual guard: `getShopifyCredentials()` fetches the shop via service
role (as instructed) but then checks `shop.user_id === user.id` before returning anything —
without that check, a logged-in user could trigger a sync against a `shop_id` that isn't theirs
just by submitting a different number. `/shops/connect`'s own page-level shop lookup (for
displaying the shop's name after creation) uses the user-scoped client instead, so RLS handles
that case with no manual check needed at all.

### Associating shops with users

`shops.user_id` (nullable, `references auth.users(id)`) is set by `createOrUpdateShop()`
(`lib/shop.ts`) whenever a caller provides it — which `/shops/new` and `/shops/connect` do (they
have a logged-in user), and the webhook does not (it has no user context to provide). One
consequence worth knowing: **shops created purely through the webhook — i.e. a Google Sheet wired
up before this feature existed, never registered through `/shops/new`/`/shops/connect` — have no
owner.** They aren't deleted or broken, but with RLS enabled, no logged-in user will see them
until someone backfills `user_id` for that row directly in Supabase.

### Google OAuth is not a login system

The Google OAuth connection described above (`/api/google/connect`, `/api/google/callback`,
`google_accounts`) is for **Drive/Sheets API access only** — it grants this app permission to
create spreadsheets in a user's own Google Drive. It does not replace or supplement Supabase Auth
as the way users log into OrderHub itself; that's still email+password (see above). A user must
already be logged in via Supabase Auth before they can connect a Google account, and the two
identities (`auth.users.id` and the connected `google_accounts.google_email`) are never assumed to
be the same email address.

This replaced an earlier, simpler approach: a single shared Google **service account** that
copied a template spreadsheet on every shop's behalf. That worked for Google Workspace accounts
(which can use Shared Drives) but always failed for an ordinary Gmail user with a Drive storage
quota error — a service account has 0 bytes of its own Drive storage, and copying a file always
tries to create the copy owned by the caller. Per-user OAuth fixes this at the root: every
spreadsheet is created inside the *connecting user's own* Drive, which has real quota.

### What was deliberately not built

Per the brief: no roles/permission levels (the Admin Center is not a separate privilege tier — see
**Project Architecture** above), no password reset, no email verification, no self-service sign-up
(accounts are created directly in the Supabase dashboard), no organizations or multi-user shops, no
invitation system. Adding any of these later is additive to this same RLS model (e.g. password
reset is a Supabase Auth feature that needs zero schema changes) — nothing here was designed in a
way that would need to be undone.

---

## Folder Structure

```
app/
  page.tsx                    # redirects to /dashboard
  layout.tsx                  # root layout + auth-aware nav bar (Dashboard/Analytics/Products/
                               # Shops/Workflows/New Shop/Connect Store/Admin/Logout)
  error.tsx                   # root error boundary (safety net for uncaught errors)
  globals.css                 # Tailwind import, nothing else
  api/
    orders/route.ts           # the public webhook — POST from Apps Script / platform sync
    cron/sync/route.ts        # hourly scheduled sync — bounded concurrency, secret-gated
    cron/automation-retry/route.ts  # every 5 min — resumes paused workflows, retries failed steps
    metrics/route.ts          # secret-gated JSON snapshot for external monitoring
    health/route.ts           # unauthenticated uptime probe, rate-limited
    google/
      connect/route.ts        # starts the per-user Google OAuth flow, redirects to Google
      callback/route.ts       # exchanges the code, saves the connection, redirects back
  login/
    page.tsx                  # email + password form
    actions.ts                # login() (rate-limited), logout() server actions
  dashboard/
    page.tsx                  # orders table + 4 KPI cards
    actions.ts                # updateOrderStatus server action
  analytics/page.tsx           # KPIs + 3 charts + 2 tables
  products/page.tsx            # read-only product list + stats
  orders/[id]/page.tsx         # order detail: customer/product info, status timeline, automation
                                # timeline (which workflow steps ran on this order, and how)
  admin/
    page.tsx                  # sync monitoring, error center, recent activity, performance stats
    actions.ts                # run sync now, test connections, retry failed workflow executions
  workflows/page.tsx           # nav entry point: 0 shops -> prompt, 1 shop -> redirects straight
                                # into its workflows, 2+ -> a small shop picker (no new workflow
                                # pages — reuses shops/[id]/workflows/ below either way)
  shops/
    new/                      # generic "create shop + provision Google Sheet" form
    connect/                  # platform connect form + auto-verified connection + Sync action panel
    [id]/workflows/           # Workflow Builder: list + editor pages, reorder/activate/test actions
    actions.ts                 # deleteShop, updateShopName, disconnectStore, updateSyncFrequency,
                                # disconnectGoogleAccount

proxy.ts                       # route protection (redirects to /login) — Next's name for middleware
instrumentation.ts              # startup env validation (lib/env-validation.ts)

components/
  ui/table.tsx                 # shadcn-style table primitives (plain HTML + Tailwind)
  charts/                      # Recharts components + shared color constants
  orders-table.tsx             # client: orders table + status select + details modal
  products-table.tsx            # client: products table + details modal
  status-select.tsx            # client: status dropdown (Server Action + useTransition)
  submit-button.tsx             # client: useFormStatus-based loading button
  detail-modal.tsx              # shared modal + row primitives (used by both tables)
  form-field.tsx / action-card.tsx / sheet-created-panel.tsx  # shared form/page building blocks
  sync-actions-panel.tsx        # Sync Products/Sync Orders cards + the Sheets hand-off explanation
  google-account-card.tsx       # connect/disconnect status card (shop new/connect/settings pages)
  workflow-status-badge.tsx / execution-status-label.tsx  # automation outcome badges
  stat-card.tsx / error-banner.tsx / system-health-badge.tsx / shop-health-badge.tsx

lib/
  supabase.ts                  # service-role client — bypasses RLS, server-only
  supabase-server.ts            # user-scoped client for Server Components/Actions — RLS applies
  supabase-middleware.ts        # session check used by proxy.ts
  google-oauth.ts                # per-user Google OAuth: consent URL, token exchange, storage
  google-sheets.ts              # Drive/Sheets API: provisioning + order-row append
  crypto.ts                      # AES-256-GCM encrypt/decrypt for stored refresh tokens
  net-guard.ts                   # SSRF guard — checked before every outbound platform/module URL
  platforms/                    # multi-platform connectors — see Project Architecture above
  workflows/                    # Workflow Engine — manager/engine/dispatch/execution-history/
                                 # resume/retry/circuit-breaker — see Project Architecture above
  automation-modules/           # the 16 workflow step types — see Project Architecture above
  sync.ts                       # per-shop product/order sync, bounded concurrency
  sync-history.ts                # writes sync_history rows (backs Dashboard + Admin)
  orders.ts                      # applyOrderStatusChange() — status writes + order_history
  shop.ts                       # createOrUpdateShop() — the only code that writes to `shops`
  env.ts / env-validation.ts    # requireEnv() + startup-time required-var checks
  validation.ts                 # isValidEmail(), ORDER_STATUSES, validateOrderPayload(), id parsing
  rate-limit.ts                 # in-memory, per-instance fixed-window limiter
  logger.ts                     # structured logging + audit events
  utils.ts                      # cn() Tailwind class helper

types/
  order.ts / product.ts / shop.ts / workflow.ts   # shapes returned by Supabase queries/RPCs

tests/
  unit/ · supabase/ · server-actions/ · webhook/ · workflows/ · connectors/ · modules/ · integration/
  mocks/                        # hand-built chainable Supabase mock + fetch mock

supabase/schema.sql             # the entire database schema — single source of truth
apps-script/sync-orders.gs      # reference copy of the Apps Script bound to the Sheet template
vercel.json                     # the 2 scheduled cron jobs — see Deployment Guide
```

---

## Security Notes

Every page under `/dashboard`, `/analytics`, `/products`, `/orders`, `/shops`, `/workflows`, and
`/admin` requires login (see **Authentication & Security Architecture** above), and RLS enforces
data isolation independently of the application code. Residual, known items:

- Shops created purely via the webhook before a user registers them through `/shops/new` or
  `/shops/connect` have `user_id = NULL` and are invisible to everyone until backfilled by hand.
- `SUPABASE_ANON_KEY` is a public-safe key by Supabase's own design, but this app never sends it to
  the browser anyway — it's used exclusively in server-only code, alongside the user's session
  cookie, to run RLS-scoped queries.
- Platform credentials (`shops.api_key`/`api_secret`) are stored as plain columns, protected only
  by RLS row-level access, not encrypted at rest — unlike the Google OAuth refresh token
  (`google_accounts.encrypted_refresh_token`), which is AES-256-GCM encrypted (`lib/crypto.ts`).
  Extending the same helper to platform credentials is a known, scoped improvement, not yet done.
- No password reset, email verification, or account self-service exists — accounts are managed
  directly in the Supabase dashboard, per the explicit scope for this phase.
