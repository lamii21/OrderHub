# OrderHub

A minimal order-management platform for merchants who track orders in Google Sheets — with an
optional path to connect a Shopify store directly. Built as an internship project, deliberately
kept as simple as the requirements allow (no Clean Architecture, no repository pattern, no
microservices, no auth system beyond what's described below).

## Stack

- **Next.js (App Router)** + **TypeScript**
- **Tailwind CSS**
- **Supabase** (Postgres + REST API, accessed via the service-role key from the server only)
- **Recharts** (analytics charts)
- **googleapis** (Google Drive/Sheets API — spreadsheet provisioning)
- Plain `fetch()` against each platform's REST API (no SDK) — Shopify, WooCommerce, and YouCan are
  all supported via a small connector registry (`lib/platforms/`, see Project Architecture below)
- **Vitest** — the test suite (`tests/`), run via `npx vitest run`

## How it works (the core pipeline)

```
Google Sheets → Google Apps Script → POST /api/orders → Supabase → Dashboard
```

Every order, regardless of where it originates, ends up as a row in a merchant's Google Sheet.
A bound Apps Script reads new rows and POSTs them to `/api/orders`, which is the **only** way
data enters Supabase from the outside. This holds even for the Shopify integration: Shopify order
sync writes new orders into the shop's Google Sheet (not into Supabase directly), so the exact
same webhook — unmodified — is what ultimately persists them. See **Project Architecture** below
for why this matters.

---

## Installation Guide

### Prerequisites

- Node.js 18+ and npm
- A Supabase account (free tier is enough)
- A Google Cloud account (for the Sheets/Drive provisioning feature — optional, see below)
- A Shopify store with API access (for the Shopify integration — optional, see below)

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
| `SUPABASE_SERVICE_ROLE_KEY` | The webhook, Google provisioning, Shopify sync | Supabase → Project Settings → API (the **secret** `service_role`/`sb_secret_...` key — never the `anon`/publishable one) |
| `SUPABASE_ANON_KEY` | Login, every protected page, RLS-scoped queries | Supabase → Project Settings → API (the public `anon`/publishable key — safe by design, but used here server-only; see Authentication below) |
| `API_SECRET` | The `/api/orders` webhook | Any value you generate yourself; it's the shared secret your Apps Script sends in the `x-api-key` header |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google Sheet provisioning (`/shops/new`, `/shops/connect`) | Google Cloud Console → IAM & Admin → Service Accounts |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Same as above | Same service account's JSON key file (`private_key` field — keep the `\n` characters) |
| `GOOGLE_SHEETS_TEMPLATE_ID` | Same as above | The file ID (from its URL) of your template spreadsheet — see Deployment Guide |

The app fails fast with a clear error naming the exact missing variable ([`lib/env.ts`](lib/env.ts))
rather than failing later with a cryptic error from inside Supabase/Google's client libraries.
Core variables (Supabase, `API_SECRET`) are validated the moment their route/page is used; Google
credentials are validated lazily inside the Google Sheets functions specifically so that an
unconfigured Google integration never breaks the rest of the app (dashboard, analytics, products
all work fine without it).

Shopify credentials are **not** environment variables — they're entered per-shop through
`/shops/connect` and stored in the `shops` table (see Security Review below for the trade-offs
of that).

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
2. IAM & Admin → Service Accounts → create one → Keys → **Create new key (JSON)**. Save
   `client_email` and `private_key` from that file.
3. Build a template spreadsheet:
   - Two tabs: **Orders** (columns A–H exactly matching `apps-script/sync-orders.gs`'s `COL`
     layout) and **Config** (`B1` = shop name, `B2` = platform, both left blank).
   - `Extensions → Apps Script`, paste `apps-script/sync-orders.gs`, fill in `API_URL` (your
     deployed `/api/orders` URL) and `API_SECRET` (must match the Vercel env var) once — this is
     shared by every shop copied from this template.
4. Share the template spreadsheet with the service account's email as at least **Viewer**
   (`files.copy` only needs read access to the source file).
5. Copy the template's file ID from its URL into `GOOGLE_SHEETS_TEMPLATE_ID`.

### 3. Vercel

1. Import the repo, set the **Environment Variables** from the table above (Production scope).
2. Deploy.
3. Update the Apps Script template's `API_URL` to the real deployed URL if you used a placeholder
   or tunnel earlier.

### 4. Shopify (only needed if connecting a real store)

Per store, in the Shopify admin: **Settings → Apps and sales channels → Develop apps → Create an
app**, grant `read_products`/`read_orders` Admin API scopes, install it, and copy the Admin API
access token into the `/shops/connect` form.

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
- **`lib/workflows/`** — the Workflow Engine: `manager.ts` resolves which of a shop's *active*
  workflows match an event, `engine.ts` (`runWorkflow`) runs a matched workflow's steps in order
  (one try/catch per step, a circuit breaker per step after repeated failures), `dispatch.ts`
  (`handleEvent`) is the single entry point both the webhook and `updateOrderStatus` call to
  trigger it. `app/shops/[id]/workflows/` is the Builder UI + Server Actions (create/edit/reorder
  steps, activate/deactivate, "Test Workflow Now") — a plain reorderable list, no drag-and-drop
  canvas.
- **`lib/automation-modules/`** — one file per step type a workflow can run (WhatsApp, email,
  Google Sheets append, webhook, tag order, update status, archive, notes, delivery, plus a few
  registered stubs), each implementing the same small `run()`/`validateConfig()` contract
  (`types.ts`) so the engine never special-cases a particular module.
- **`app/admin/`** — the Admin & Monitoring Center: sync/workflow statistics, an error center, and
  manual "run now"/"retry failed" actions, all read-scoped to the logged-in user's own shops via
  RLS like every other page (no cross-user admin view).
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

Two relationships are matched by *value*, not by foreign key, because the pipeline above never
carries a stable ID for them:

- `orders.shop_id` **is** a real foreign key (set by the webhook via `shops.sheet_id` upsert).
- A product's order stats are matched by `(orders.shop_id = products.shop_id AND orders.product =
  products.name)` — free-text match, because `orders` has no `product_id` column. If a product is
  renamed, its historical orders stop matching. This is a known, accepted trade-off for an MVP —
  see Final Review.

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

Email + password only (Supabase Auth) — no OAuth, no magic links, no roles, no admin mode. Every
signed-up user sees only the shops, orders, and products they created.

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
across that rename) runs `lib/supabase-middleware.ts`'s `updateSession()` on every request to
`/dashboard`, `/analytics`, `/products`, `/shops/new`, and `/shops/connect`. It checks
`supabase.auth.getUser()`; if there's no user, it redirects to `/login` before the page ever
renders. `/api/orders` is intentionally **not** in this matcher — it has its own, separate
`x-api-key` check, since Google's servers can't sign in.

### Row Level Security

This is what actually enforces "you only see your own data," not application code. All three
tables (`shops`, `orders`, `products`) have RLS policies (`supabase/schema.sql`) scoping every
`select`/`update`/`insert` to `auth.uid()`:

- `shops`: `select`/`insert`/`update` where `user_id = auth.uid()`.
- `orders`: `select`/`update` where `shop_id in (select id from shops where user_id = auth.uid())`.
- `products`: `select` where the same shop-ownership check.

Because every dashboard/analytics/products query already went through the 6 existing Postgres
functions (`get_dashboard_stats`, `get_products_with_stats`, etc.) instead of raw table selects,
and those functions are `security invoker` (the default — they run as whichever role called
them), simply switching the *caller* from the service-role key to the logged-in user's own session
makes every existing aggregate correctly scoped to that user's shops. **None of the SQL function
bodies changed.** This is why item 8 ("no filters, no admin mode") holds: there's no `shop_id`
filter to write, because RLS already restricted what the underlying tables return before the
aggregate ever ran.

### Why the service role is still required

Three flows have no logged-in user in the request at all, so there's nothing for RLS to check
`auth.uid()` against — they keep using `lib/supabase.ts` (the service-role client, bypasses RLS):

- **The webhook** (`/api/orders`) — called by Google Apps Script, an external system with no
  Supabase session.
- **Google provisioning** (`lib/google-sheets.ts`) — talks to the Google Drive/Sheets API using a
  Google service account, unrelated to Supabase Auth entirely, but the shop row it's tied to still
  gets written via `createOrUpdateShop()` (service-role).
- **Shopify sync** (`syncProducts`/`syncOrders` in `app/shops/connect/actions.ts`) — reads a
  shop's stored Shopify credentials and upserts products, using the service role rather than
  threading a per-request user session through `lib/shopify.ts`.

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

### What was deliberately not built

Per the brief: no roles/permissions, no admin dashboard, no password reset, no email verification,
no organizations or multi-user shops, no OAuth, no invitation system. Adding any of these later is
additive to this same RLS model (e.g. password reset is a Supabase Auth feature that needs zero
schema changes) — nothing here was designed in a way that would need to be undone.

---

## Folder Structure

```
app/
  page.tsx                    # redirects to /dashboard
  layout.tsx                  # root layout + auth-aware nav bar
  error.tsx                   # root error boundary (safety net for uncaught errors)
  globals.css                 # Tailwind import, nothing else
  api/
    orders/route.ts           # the public webhook — POST from Apps Script / platform sync
    cron/sync/route.ts        # scheduled sync — bounded concurrency, rate-limited, secret-gated
    health/route.ts           # unauthenticated uptime probe, rate-limited
  login/
    page.tsx                  # email + password form
    actions.ts                # login() (rate-limited), logout() server actions
  dashboard/
    page.tsx                  # orders table + 4 KPI cards
    actions.ts                # updateOrderStatus server action
  analytics/page.tsx           # KPIs + 3 charts + 2 tables
  products/page.tsx            # read-only product list + stats
  admin/
    page.tsx                  # sync/workflow stats, error center, system health
    actions.ts                # run sync now, test connections, retry failed workflow executions
  shops/
    new/                      # generic "create shop + provision Google Sheet" form
    connect/                  # platform connect form + Test/Sync action panel
    [id]/workflows/           # Workflow Builder: list + editor pages, reorder/activate/test actions
    actions.ts                 # deleteShop, updateShopName, disconnectStore, updateSyncFrequency

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
  stat-card.tsx / error-banner.tsx / system-health-badge.tsx

lib/
  supabase.ts                  # service-role client — bypasses RLS, server-only
  supabase-server.ts            # user-scoped client for Server Components/Actions — RLS applies
  supabase-middleware.ts        # session check used by proxy.ts
  google-sheets.ts              # Drive/Sheets API: provisioning + order-row append
  platforms/                    # multi-platform connectors — see Project Architecture above
  workflows/                    # Workflow Engine — manager/engine/dispatch/execution-history
  automation-modules/           # one file per workflow step type (whatsapp, email, webhook, ...)
  sync.ts                       # per-shop product/order sync, bounded concurrency
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
```

---

## Security Notes

All 5 previously-public pages now require login (see **Authentication & Security Architecture**
above) and RLS enforces data isolation independently of the application code. Residual, known
items:

- Shops created purely via the webhook before a user registers them through `/shops/new` or
  `/shops/connect` have `user_id = NULL` and are invisible to everyone until backfilled by hand.
- `SUPABASE_ANON_KEY` is a public-safe key by Supabase's own design, but this app never sends it to
  the browser anyway — it's used exclusively in server-only code, alongside the user's session
  cookie, to run RLS-scoped queries.
- No password reset, email verification, or account self-service exists — accounts are managed
  directly in the Supabase dashboard, per the explicit scope for this phase.
