create table if not exists shops (
  id bigint generated always as identity primary key,
  name text not null,
  platform text not null,
  sheet_id text unique,
  sheet_name text,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id bigint generated always as identity primary key,
  shop_id bigint references shops(id),
  order_id text,
  customer_name text,
  customer_phone text,
  customer_city text,
  customer_address text,
  product text,
  quantity integer,
  price numeric(10, 2),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds the multi-shop columns to an orders table created
-- before this feature existed.
alter table orders add column if not exists shop_id bigint references shops(id);
alter table orders add column if not exists customer_phone text;
alter table orders add column if not exists customer_city text;
alter table orders add column if not exists customer_address text;

create index if not exists orders_created_at_idx on orders (created_at desc);
create index if not exists orders_shop_id_idx on orders (shop_id);

-- RLS stays on with no policies: the API route uses the service role key
-- (bypasses RLS), and there is no client-side/anon access in this MVP.
alter table shops enable row level security;
alter table orders enable row level security;

-- Single aggregate query backing the 4 dashboard stat cards.
create or replace function get_dashboard_stats()
returns table (
  total_orders bigint,
  pending_orders bigint,
  delivered_orders bigint,
  total_revenue numeric
)
language sql
stable
as $$
  select
    count(*) as total_orders,
    count(*) filter (where status = 'pending') as pending_orders,
    count(*) filter (where status = 'delivered') as delivered_orders,
    coalesce(sum(price * quantity), 0) as total_revenue
  from orders;
$$;

-- Backs the "Orders per day" line chart on /analytics.
create or replace function get_orders_per_day()
returns table (
  day date,
  orders_count bigint
)
language sql
stable
as $$
  select
    date_trunc('day', created_at)::date as day,
    count(*) as orders_count
  from orders
  group by day
  order by day;
$$;

-- Backs the "Top 10 best-selling products" chart + table on /analytics.
create or replace function get_top_products()
returns table (
  product text,
  quantity_sold bigint,
  revenue numeric
)
language sql
stable
as $$
  select
    product,
    sum(quantity) as quantity_sold,
    coalesce(sum(price * quantity), 0) as revenue
  from orders
  where product is not null
  group by product
  order by quantity_sold desc
  limit 10;
$$;

-- Backs the "Revenue by city" chart + table on /analytics.
create or replace function get_revenue_by_city()
returns table (
  city text,
  orders_count bigint,
  revenue numeric
)
language sql
stable
as $$
  select
    customer_city as city,
    count(*) as orders_count,
    coalesce(sum(price * quantity), 0) as revenue
  from orders
  where customer_city is not null
  group by customer_city
  order by revenue desc;
$$;

-- Products are read-only for now (no Shopify sync yet); rows are added by hand.
-- Matched to orders by (shop_id, product name) since orders has no product_id —
-- reusing the existing orders/shops shape rather than adding a new relation.
create table if not exists products (
  id bigint generated always as identity primary key,
  shop_id bigint references shops(id),
  name text not null,
  sku text,
  description text,
  price numeric(10, 2),
  stock_quantity integer,
  created_at timestamptz not null default now()
);

create index if not exists products_shop_id_idx on products (shop_id);

alter table products enable row level security;

-- Backs the /products table: one row per product with its shop/platform and
-- order stats matched by (shop_id, product name).
create or replace function get_products_with_stats()
returns table (
  id bigint,
  shop_id bigint,
  name text,
  sku text,
  description text,
  price numeric,
  stock_quantity integer,
  created_at timestamptz,
  shop_name text,
  platform text,
  total_orders bigint,
  total_revenue numeric
)
language sql
stable
as $$
  select
    p.id,
    p.shop_id,
    p.name,
    p.sku,
    p.description,
    p.price,
    p.stock_quantity,
    p.created_at,
    s.name as shop_name,
    s.platform,
    count(o.id) as total_orders,
    coalesce(sum(o.price * o.quantity), 0) as total_revenue
  from products p
  left join shops s on s.id = p.shop_id
  left join orders o on o.shop_id = p.shop_id and o.product = p.name
  group by p.id, p.name, p.sku, p.description, p.price, p.stock_quantity, p.created_at, s.name, s.platform
  order by p.created_at desc;
$$;

-- Backs the 3 stat cards on /products.
create or replace function get_product_stats()
returns table (
  total_products bigint,
  out_of_stock_products bigint,
  best_selling_product text
)
language sql
stable
as $$
  select
    (select count(*) from products) as total_products,
    (select count(*) from products where coalesce(stock_quantity, 0) <= 0) as out_of_stock_products,
    (
      select p.name
      from products p
      left join orders o on o.shop_id = p.shop_id and o.product = p.name
      group by p.id, p.name
      order by coalesce(sum(o.quantity), 0) desc
      limit 1
    ) as best_selling_product;
$$;

-- Shopify integration: credentials + incremental-sync cursor for /shops/connect.
-- Token is stored in plain text (protected by RLS + server-only service-role
-- access, never sent to the client) — an intentional MVP trade-off, not
-- encrypted at rest. Revisit if/when this needs to survive a DB-level leak.
alter table shops add column if not exists shopify_store_url text;
alter table shops add column if not exists shopify_access_token text;
alter table shops add column if not exists shopify_last_synced_at timestamptz;

-- Stable identifier for upserting products synced from Shopify. Manually
-- created products keep this null (a unique index allows multiple nulls),
-- so the sample rows from the read-only Product Management feature are
-- untouched by the sync.
alter table products add column if not exists shopify_product_id text;
create unique index if not exists products_shopify_product_id_key on products (shopify_product_id);

-- Speeds up the (shop_id, product name) join used by get_products_with_stats()
-- and get_product_stats() to match orders to products.
create index if not exists orders_shop_product_idx on orders (shop_id, product);

-- ==== Hardening phase: data-integrity fixes from the architecture audit ====

-- Enforces the same 6 statuses at the database layer, not just in application
-- code — closes the gap where the webhook could previously write any string.
-- Postgres has no "add constraint if not exists", so drop-then-add is the
-- idempotent equivalent (safe to re-run).
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'));

-- Lets the webhook upsert on (shop_id, order_id) instead of always inserting,
-- so receiving the same order twice updates it instead of duplicating it.
-- order_id is nullable: rows without one (the current Google Sheets flow
-- never sends order_id) are never considered duplicates of each other,
-- since Postgres treats every NULL in a unique index as distinct — this
-- protection only applies once a caller (e.g. a future Shopify order_id)
-- actually supplies the value.
create unique index if not exists orders_shop_order_unique on orders (shop_id, order_id);

-- Prevents two product rows for the same shop sharing a name, which
-- previously caused get_products_with_stats()'s join to fan out and
-- double-count that product's orders/revenue once per duplicate row.
create unique index if not exists products_shop_name_unique on products (shop_id, name);

-- ==== Authentication & data isolation ====

-- Links a shop to the Supabase Auth user who owns it. Nullable: shops
-- created purely through the webhook (no logged-in user in that request)
-- have no owner until someone registers that shop through /shops/new or
-- /shops/connect while signed in — see README "Authentication" section for
-- what this means for shops that already existed before this change.
alter table shops add column if not exists user_id uuid references auth.users(id);

-- The app now runs its own reads/writes (dashboard, analytics, products,
-- status updates) as the logged-in user instead of the service-role key, so
-- RLS is what actually enforces "you only see your own data" — these grants
-- are the table-level access PostgREST needs before RLS is even evaluated.
-- Service-role-only flows (the webhook, Google provisioning, Shopify sync)
-- are unaffected: the service role bypasses RLS entirely.
grant select, insert, update on shops to authenticated;
grant select, update on orders to authenticated;
grant select on products to authenticated;
grant execute on function get_dashboard_stats() to authenticated;
grant execute on function get_orders_per_day() to authenticated;
grant execute on function get_top_products() to authenticated;
grant execute on function get_revenue_by_city() to authenticated;
grant execute on function get_products_with_stats() to authenticated;
grant execute on function get_product_stats() to authenticated;

-- Postgres has no "create policy if not exists"; drop-then-create is the
-- idempotent equivalent used throughout this file.
drop policy if exists "Users can view their own shops" on shops;
create policy "Users can view their own shops"
  on shops for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their own shops" on shops;
create policy "Users can insert their own shops"
  on shops for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own shops" on shops;
create policy "Users can update their own shops"
  on shops for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can view orders for their own shops" on orders;
create policy "Users can view orders for their own shops"
  on orders for select
  to authenticated
  using (shop_id in (select id from shops where user_id = auth.uid()));

drop policy if exists "Users can update orders for their own shops" on orders;
create policy "Users can update orders for their own shops"
  on orders for update
  to authenticated
  using (shop_id in (select id from shops where user_id = auth.uid()))
  with check (shop_id in (select id from shops where user_id = auth.uid()));

drop policy if exists "Users can view products for their own shops" on products;
create policy "Users can view products for their own shops"
  on products for select
  to authenticated
  using (shop_id in (select id from shops where user_id = auth.uid()));

-- ==== Shop Management (/shops, /shops/[id]) ====

-- Backs both /shops (the list) and /shops/[id] (the detail view) — one
-- function serves both, since RLS already scopes the result to the caller's
-- own shops and a single user's shop count is expected to stay small. Product
-- and order counts are pre-aggregated in separate CTEs before joining back to
-- shops, so a shop with both several products and several orders doesn't
-- fan out into a cross-product that would inflate the counts/revenue.
--
-- Guarded even on this first definition: every later redefinition below
-- already drops-then-creates when its return columns change, but re-running
-- this whole file against a database that's only partially caught up (i.e.
-- already has a later, wider version of this function installed) would
-- otherwise fail right here with "cannot change return type of existing
-- function" — Postgres can't CREATE OR REPLACE across a signature change.
drop function if exists get_shops_with_stats();
create or replace function get_shops_with_stats()
returns table (
  id bigint,
  name text,
  platform text,
  sheet_id text,
  sheet_name text,
  shopify_store_url text,
  created_at timestamptz,
  product_count bigint,
  order_count bigint,
  total_revenue numeric
)
language sql
stable
as $$
  with product_counts as (
    select shop_id, count(*) as product_count
    from products
    group by shop_id
  ),
  order_stats as (
    select shop_id, count(*) as order_count, coalesce(sum(price * quantity), 0) as total_revenue
    from orders
    group by shop_id
  )
  select
    s.id,
    s.name,
    s.platform,
    s.sheet_id,
    s.sheet_name,
    s.shopify_store_url,
    s.created_at,
    coalesce(pc.product_count, 0) as product_count,
    coalesce(os.order_count, 0) as order_count,
    coalesce(os.total_revenue, 0) as total_revenue
  from shops s
  left join product_counts pc on pc.shop_id = s.id
  left join order_stats os on os.shop_id = s.id
  order by s.created_at desc;
$$;

grant execute on function get_shops_with_stats() to authenticated;

-- Deleting a shop is a hard delete of the shop plus its orders and products
-- (app/shops/actions.ts -> deleteShop), run as the logged-in user so these
-- policies — not application code — are what stop someone from deleting
-- anything that isn't theirs.
grant delete on shops, orders, products to authenticated;

drop policy if exists "Users can delete their own shops" on shops;
create policy "Users can delete their own shops"
  on shops for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can delete orders for their own shops" on orders;
create policy "Users can delete orders for their own shops"
  on orders for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = auth.uid()));

drop policy if exists "Users can delete products for their own shops" on products;
create policy "Users can delete products for their own shops"
  on products for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = auth.uid()));

-- No new indexes needed: orders_shop_id_idx and products_shop_id_idx (added
-- earlier) already cover every shop_id lookup this feature does, including
-- the CTEs above and the cascading delete.

-- ==== Synchronization History ====

-- One row per Sync Products / Sync Orders run (app/shops/connect/actions.ts).
-- Written by recordSyncHistory() using the service-role client (same as the
-- rest of Shopify sync), so `authenticated` only ever needs read access.
create table if not exists sync_history (
  id bigint generated always as identity primary key,
  shop_id bigint references shops(id),
  type text not null check (type in ('products', 'orders')),
  status text not null check (status in ('success', 'failed')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null,
  imported_count integer,
  message text
);

create index if not exists sync_history_shop_id_idx on sync_history (shop_id);
create index if not exists sync_history_started_at_idx on sync_history (started_at desc);

alter table sync_history enable row level security;

-- Read-only for users, matching the existing ownership model (shop_id in
-- the caller's own shops). No insert/update/delete policy for `authenticated`
-- at all: only the service-role client ever writes history, and users have
-- no legitimate reason to edit their own audit log.
grant select on sync_history to authenticated;

drop policy if exists "Users can view sync history for their own shops" on sync_history;
create policy "Users can view sync history for their own shops"
  on sync_history for select
  to authenticated
  using (shop_id in (select id from shops where user_id = auth.uid()));

-- ==== Order Status History ====

-- One row per status change (app/dashboard/actions.ts -> updateOrderStatus).
-- Unlike sync_history, this is written by a genuinely user-initiated action
-- using the user-scoped client, so — unlike sync_history — `authenticated`
-- needs an INSERT policy too, not just SELECT.
create table if not exists order_history (
  id bigint generated always as identity primary key,
  order_id bigint references orders(id),
  previous_status text check (previous_status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  new_status text not null check (new_status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists order_history_order_id_idx on order_history (order_id);
create index if not exists order_history_created_at_idx on order_history (created_at desc);

alter table order_history enable row level security;

grant select, insert on order_history to authenticated;

-- Same ownership model as everywhere else, just one level further removed:
-- an order's owner is determined by its shop, so this checks order_id ->
-- shop_id -> user_id instead of a direct shop_id -> user_id like orders/
-- products/sync_history do.
drop policy if exists "Users can view order history for their own shops" on order_history;
create policy "Users can view order history for their own shops"
  on order_history for select
  to authenticated
  using (
    order_id in (
      select id from orders where shop_id in (select id from shops where user_id = auth.uid())
    )
  );

-- Also requires changed_by to be the inserting user themselves, so one
-- user's status change can never be attributed to someone else.
drop policy if exists "Users can record status changes for their own orders" on order_history;
create policy "Users can record status changes for their own orders"
  on order_history for insert
  to authenticated
  with check (
    changed_by = auth.uid()
    and order_id in (
      select id from orders where shop_id in (select id from shops where user_id = auth.uid())
    )
  );

-- ==== Multi-platform migration (Shopify -> Shopify/YouCan/WooCommerce) ====
-- These columns were named shopify_* back when Shopify was the only
-- integration. Now that lib/platforms/ dispatches on shop.platform, a
-- YouCan or WooCommerce shop storing its credentials in a column literally
-- named "shopify_access_token" would be misleading, so they're renamed to
-- generic names. Renames use a guarded DO block (not just "if not exists",
-- which alter/rename doesn't support) so this file stays safe to re-run.
--
-- Each guard also checks the TARGET column doesn't already exist, not just
-- that the source does — without that, re-running this file against a
-- database where the rename already happened once hits "add column if not
-- exists shopify_store_url" above (which doesn't know the migration already
-- ran, and recreates the old column fresh), then fails right here with
-- "column store_url already exists" the moment it tries to rename into a
-- name that's already taken.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'shopify_store_url'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'store_url'
  ) then
    alter table shops rename column shopify_store_url to store_url;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'shopify_access_token'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'api_key'
  ) then
    alter table shops rename column shopify_access_token to api_key;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'shopify_last_synced_at'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'last_synced_at'
  ) then
    alter table shops rename column shopify_last_synced_at to last_synced_at;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'products' and column_name = 'shopify_product_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'products' and column_name = 'platform_product_id'
  ) then
    alter table products rename column shopify_product_id to platform_product_id;
  end if;
end $$;

-- WooCommerce authenticates with a Consumer Key + Consumer Secret pair, so
-- unlike Shopify/YouCan (one token) it needs a second secret column. Stays
-- null for platforms that don't use it.
alter table shops add column if not exists api_secret text;

-- The old index was keyed on platform_product_id alone, so two different
-- platforms' products could collide on the same numeric ID and silently
-- overwrite each other on upsert. Scoping uniqueness to (shop_id,
-- platform_product_id) is what syncProducts()'s upsert actually needs.
drop index if exists products_shopify_product_id_key;
create unique index if not exists products_shop_platform_product_key
  on products (shop_id, platform_product_id);

-- Postgres rejects "create or replace" when a function's output columns
-- change shape, so the old shopify_store_url-returning version has to be
-- dropped before recreating it with store_url.
drop function if exists get_shops_with_stats();

create or replace function get_shops_with_stats()
returns table (
  id bigint,
  name text,
  platform text,
  sheet_id text,
  sheet_name text,
  store_url text,
  created_at timestamptz,
  product_count bigint,
  order_count bigint,
  total_revenue numeric
)
language sql
stable
as $$
  with product_counts as (
    select shop_id, count(*) as product_count
    from products
    group by shop_id
  ),
  order_stats as (
    select shop_id, count(*) as order_count, coalesce(sum(price * quantity), 0) as total_revenue
    from orders
    group by shop_id
  )
  select
    s.id,
    s.name,
    s.platform,
    s.sheet_id,
    s.sheet_name,
    s.store_url,
    s.created_at,
    coalesce(pc.product_count, 0) as product_count,
    coalesce(os.order_count, 0) as order_count,
    coalesce(os.total_revenue, 0) as total_revenue
  from shops s
  left join product_counts pc on pc.shop_id = s.id
  left join order_stats os on os.shop_id = s.id
  order by s.created_at desc;
$$;

grant execute on function get_shops_with_stats() to authenticated;

-- ==== Automatic synchronization scheduler ====

-- The 4 selectable cadences (lib/sync-schedule.ts is the single source of
-- truth for the actual hour counts each one maps to — this CHECK just stops
-- a stray value from ever being written by anything other than the
-- validated <select> on /shops/[id]).
alter table shops add column if not exists sync_frequency text not null default 'daily'
  check (sync_frequency in ('hourly', 'every_6h', 'every_12h', 'daily'));

-- Stamped by lib/sync.ts on every sync attempt for a shop — manual click or
-- cron-triggered, success or failure, doesn't matter. Doubles as both the
-- "Last Sync" value shown in the UI and the input to
-- lib/sync-schedule.ts's isSyncDue()/computeNextSyncAt(), so a manual sync
-- correctly pushes back the next automatic run instead of firing again a
-- few minutes later. Deliberately separate from shops.last_synced_at, which
-- is the platform API's incremental-fetch cursor (only advances when new
-- orders are actually found) and would be the wrong signal for "when did we
-- last try".
alter table shops add column if not exists last_sync_attempt_at timestamptz;

-- ==== Connected Stores Management ====

-- get_shops_with_stats() return shape is changing again — same reason as
-- every prior extension: Postgres won't let "create or replace" change a
-- function's output columns.
drop function if exists get_shops_with_stats();

-- last_sync_status/last_success_sync_at/last_failed_sync_at are all derived
-- from sync_history, which already exists — nothing new is written, this
-- just surfaces it. last_sync_status backs the health badge (§2 of the
-- Connected Stores Management feature): a shop's most recent attempt
-- (whichever of products/orders actually ran last) failing is exactly what
-- "Needs Attention" means. last_sync_attempt_at (added for the scheduler)
-- already covers "Latest synchronization" — no new column needed for that.
create or replace function get_shops_with_stats()
returns table (
  id bigint,
  name text,
  platform text,
  sheet_id text,
  sheet_name text,
  store_url text,
  sync_frequency text,
  last_sync_attempt_at timestamptz,
  last_sync_status text,
  last_success_sync_at timestamptz,
  last_failed_sync_at timestamptz,
  created_at timestamptz,
  product_count bigint,
  order_count bigint,
  total_revenue numeric
)
language sql
stable
as $$
  with product_counts as (
    select shop_id, count(*) as product_count
    from products
    group by shop_id
  ),
  order_stats as (
    select shop_id, count(*) as order_count, coalesce(sum(price * quantity), 0) as total_revenue
    from orders
    group by shop_id
  )
  select
    s.id,
    s.name,
    s.platform,
    s.sheet_id,
    s.sheet_name,
    s.store_url,
    s.sync_frequency,
    s.last_sync_attempt_at,
    (
      select sh.status from sync_history sh
      where sh.shop_id = s.id
      order by sh.started_at desc
      limit 1
    ) as last_sync_status,
    (
      select max(sh.started_at) from sync_history sh
      where sh.shop_id = s.id and sh.status = 'success'
    ) as last_success_sync_at,
    (
      select max(sh.started_at) from sync_history sh
      where sh.shop_id = s.id and sh.status = 'failed'
    ) as last_failed_sync_at,
    s.created_at,
    coalesce(pc.product_count, 0) as product_count,
    coalesce(os.order_count, 0) as order_count,
    coalesce(os.total_revenue, 0) as total_revenue
  from shops s
  left join product_counts pc on pc.shop_id = s.id
  left join order_stats os on os.shop_id = s.id
  order by s.created_at desc;
$$;

grant execute on function get_shops_with_stats() to authenticated;

-- ==== Store Settings ====

-- General Settings: currency/timezone are stored-only preferences for now —
-- nothing in the app reads them yet (see the Store Settings feature's final
-- write-up for why that's deliberate, not an oversight).
alter table shops add column if not exists currency text not null default 'USD';
alter table shops add column if not exists timezone text not null default 'UTC';

-- Notification Settings. All default true except email (never sent, "future
-- use" only per the brief) so every existing shop keeps syncing exactly as
-- before once this migration runs — nothing changes until a user actually
-- flips one of these off. auto_sync_enabled/sync_products_enabled/
-- sync_orders_enabled are read by app/api/cron/sync/route.ts; they never
-- affect the manual "Sync Products Now"/"Sync Orders Now" buttons, which
-- stay a deliberate, explicit action regardless of these settings.
alter table shops add column if not exists sync_products_enabled boolean not null default true;
alter table shops add column if not exists sync_orders_enabled boolean not null default true;
alter table shops add column if not exists auto_sync_enabled boolean not null default true;
alter table shops add column if not exists email_notifications_enabled boolean not null default false;

drop function if exists get_shops_with_stats();

create or replace function get_shops_with_stats()
returns table (
  id bigint,
  name text,
  platform text,
  sheet_id text,
  sheet_name text,
  store_url text,
  sync_frequency text,
  last_sync_attempt_at timestamptz,
  last_sync_status text,
  last_success_sync_at timestamptz,
  last_failed_sync_at timestamptz,
  currency text,
  timezone text,
  sync_products_enabled boolean,
  sync_orders_enabled boolean,
  auto_sync_enabled boolean,
  email_notifications_enabled boolean,
  created_at timestamptz,
  product_count bigint,
  order_count bigint,
  total_revenue numeric
)
language sql
stable
as $$
  with product_counts as (
    select shop_id, count(*) as product_count
    from products
    group by shop_id
  ),
  order_stats as (
    select shop_id, count(*) as order_count, coalesce(sum(price * quantity), 0) as total_revenue
    from orders
    group by shop_id
  )
  select
    s.id,
    s.name,
    s.platform,
    s.sheet_id,
    s.sheet_name,
    s.store_url,
    s.sync_frequency,
    s.last_sync_attempt_at,
    (
      select sh.status from sync_history sh
      where sh.shop_id = s.id
      order by sh.started_at desc
      limit 1
    ) as last_sync_status,
    (
      select max(sh.started_at) from sync_history sh
      where sh.shop_id = s.id and sh.status = 'success'
    ) as last_success_sync_at,
    (
      select max(sh.started_at) from sync_history sh
      where sh.shop_id = s.id and sh.status = 'failed'
    ) as last_failed_sync_at,
    s.currency,
    s.timezone,
    s.sync_products_enabled,
    s.sync_orders_enabled,
    s.auto_sync_enabled,
    s.email_notifications_enabled,
    s.created_at,
    coalesce(pc.product_count, 0) as product_count,
    coalesce(os.order_count, 0) as order_count,
    coalesce(os.total_revenue, 0) as total_revenue
  from shops s
  left join product_counts pc on pc.shop_id = s.id
  left join order_stats os on os.shop_id = s.id
  order by s.created_at desc;
$$;

grant execute on function get_shops_with_stats() to authenticated;

-- ==== Administration & Monitoring Center ====

-- Stamped by disconnectStore()/reconnectShop() (app/shops/actions.ts,
-- app/shops/connect/actions.ts) — both already-existing actions, each now
-- setting one more column on the exact same update they already perform.
-- Backs the /admin Recent Activity feed's "Reconnected"/"Disconnected"
-- events: only the single most recent credential change per shop is
-- tracked (no full history table), so the feed labels each entry using the
-- shop's CURRENT store_url state — fully accurate for the latest toggle,
-- and a deliberate simplification rather than a new table for rapid
-- back-to-back toggles.
alter table shops add column if not exists credentials_changed_at timestamptz;

-- Backs the Performance section of /admin — the one aggregate nothing
-- existing computes. Everything else there reuses get_shops_with_stats(),
-- get_orders_per_day(), get_product_stats(), or plain filtered selects
-- against sync_history. security invoker (the default) means this
-- automatically inherits sync_history's existing "Users can view sync
-- history for their own shops" RLS policy — no new policy needed.
--
-- Guarded on this first definition too — same "re-running against a
-- database that already has the later, wider version installed" reasoning
-- as get_shops_with_stats()'s own guard above; this function's return
-- columns also change further down (see the drop before its 2nd definition).
drop function if exists get_sync_performance_stats();
create or replace function get_sync_performance_stats()
returns table (
  avg_duration_ms numeric,
  max_duration_ms integer,
  min_duration_ms integer,
  success_rate numeric
)
language sql
stable
as $$
  select
    coalesce(avg(duration_ms), 0) as avg_duration_ms,
    coalesce(max(duration_ms), 0) as max_duration_ms,
    coalesce(min(duration_ms), 0) as min_duration_ms,
    coalesce(
      round(100.0 * count(*) filter (where status = 'success') / nullif(count(*), 0), 1),
      0
    ) as success_rate
  from sync_history;
$$;

grant execute on function get_sync_performance_stats() to authenticated;

-- ==== Administration & Monitoring Center v2 (expanded) ====

-- Stamped by the existing regenerateSpreadsheet() (app/shops/[id]/settings/
-- actions.ts) on the same update it already performs — backs /admin's
-- Recent Activity "Spreadsheet regenerated" events and the Audit section's
-- "Last Spreadsheet Generated" (a shop that's never been regenerated falls
-- back to shops.created_at in application code, not here).
alter table shops add column if not exists sheet_regenerated_at timestamptz;

-- get_shops_with_stats() extended a 6th time — same reasoning as every
-- prior extension: one shop-admin query stays the single source for every
-- page needing shop-level data, rather than each page writing its own
-- overlapping variant. The 4 new fields back /admin's Synchronization
-- Monitoring table (one row per shop, not per sync_history entry).
drop function if exists get_shops_with_stats();

create or replace function get_shops_with_stats()
returns table (
  id bigint,
  name text,
  platform text,
  sheet_id text,
  sheet_name text,
  store_url text,
  sync_frequency text,
  last_sync_attempt_at timestamptz,
  last_sync_status text,
  last_success_sync_at timestamptz,
  last_failed_sync_at timestamptz,
  last_sync_duration_ms integer,
  last_sync_message text,
  last_products_imported_count integer,
  last_orders_imported_count integer,
  currency text,
  timezone text,
  sync_products_enabled boolean,
  sync_orders_enabled boolean,
  auto_sync_enabled boolean,
  email_notifications_enabled boolean,
  created_at timestamptz,
  product_count bigint,
  order_count bigint,
  total_revenue numeric
)
language sql
stable
as $$
  with product_counts as (
    select shop_id, count(*) as product_count
    from products
    group by shop_id
  ),
  order_stats as (
    select shop_id, count(*) as order_count, coalesce(sum(price * quantity), 0) as total_revenue
    from orders
    group by shop_id
  )
  select
    s.id,
    s.name,
    s.platform,
    s.sheet_id,
    s.sheet_name,
    s.store_url,
    s.sync_frequency,
    s.last_sync_attempt_at,
    -- status/duration_ms/message all came from 3 separate correlated
    -- subqueries here (one round trip each to find the *same* most-recent
    -- sync_history row, just to read a different column off it) — a single
    -- LATERAL join finds that one row once and every column below reads off
    -- it for free.
    last_sync.status as last_sync_status,
    (
      select max(sh.started_at) from sync_history sh
      where sh.shop_id = s.id and sh.status = 'success'
    ) as last_success_sync_at,
    (
      select max(sh.started_at) from sync_history sh
      where sh.shop_id = s.id and sh.status = 'failed'
    ) as last_failed_sync_at,
    last_sync.duration_ms as last_sync_duration_ms,
    last_sync.message as last_sync_message,
    (
      select sh.imported_count from sync_history sh
      where sh.shop_id = s.id and sh.type = 'products'
      order by sh.started_at desc
      limit 1
    ) as last_products_imported_count,
    (
      select sh.imported_count from sync_history sh
      where sh.shop_id = s.id and sh.type = 'orders'
      order by sh.started_at desc
      limit 1
    ) as last_orders_imported_count,
    s.currency,
    s.timezone,
    s.sync_products_enabled,
    s.sync_orders_enabled,
    s.auto_sync_enabled,
    s.email_notifications_enabled,
    s.created_at,
    coalesce(pc.product_count, 0) as product_count,
    coalesce(os.order_count, 0) as order_count,
    coalesce(os.total_revenue, 0) as total_revenue
  from shops s
  left join product_counts pc on pc.shop_id = s.id
  left join order_stats os on os.shop_id = s.id
  left join lateral (
    select sh.status, sh.duration_ms, sh.message
    from sync_history sh
    where sh.shop_id = s.id
    order by sh.started_at desc
    limit 1
  ) last_sync on true
  order by s.created_at desc;
$$;

grant execute on function get_shops_with_stats() to authenticated;

-- get_sync_performance_stats() extended with average imported counts per
-- sync type — avg(imported_count) already ignores failed rows on its own
-- (recordSyncHistory only ever sets imported_count on the success path, so
-- it's NULL for failures, which Postgres's avg() skips automatically).
drop function if exists get_sync_performance_stats();

create or replace function get_sync_performance_stats()
returns table (
  avg_duration_ms numeric,
  max_duration_ms integer,
  min_duration_ms integer,
  success_rate numeric,
  avg_imported_orders numeric,
  avg_imported_products numeric
)
language sql
stable
as $$
  select
    coalesce(avg(duration_ms), 0) as avg_duration_ms,
    coalesce(max(duration_ms), 0) as max_duration_ms,
    coalesce(min(duration_ms), 0) as min_duration_ms,
    coalesce(
      round(100.0 * count(*) filter (where status = 'success') / nullif(count(*), 0), 1),
      0
    ) as success_rate,
    coalesce((select round(avg(imported_count), 1) from sync_history where type = 'orders'), 0)
      as avg_imported_orders,
    coalesce((select round(avg(imported_count), 1) from sync_history where type = 'products'), 0)
      as avg_imported_products
  from sync_history;
$$;

grant execute on function get_sync_performance_stats() to authenticated;

-- ==== Implementation audit follow-up (Critical/High priority fixes) ====

-- shops.user_id is the column every RLS policy below filters or subqueries
-- on (directly for shops, via "shop_id in (select id from shops where
-- user_id = ...)" for orders/products/sync_history/order_history) — it had
-- no index at all, so every one of those checks was a sequential scan of
-- the whole shops table on every request.
create index if not exists shops_user_id_idx on shops (user_id);

-- Orders have always been matched to products by (shop_id, product name)
-- text — see get_products_with_stats()/get_product_stats() above — which
-- silently orphans an order's stats the moment a product is renamed. This
-- adds a real foreign key so future orders keep a stable link to the
-- product row they were placed against, independent of later renames.
-- Nullable + no backfill: existing rows keep matching by name exactly as
-- before (see the join fallback below), only new rows (written by
-- app/api/orders/route.ts, the only code path that inserts into orders)
-- populate this going forward.
alter table orders add column if not exists product_id bigint references products(id);
create index if not exists orders_product_id_idx on orders (product_id);

-- Both functions now prefer the stable product_id match and only fall back
-- to the legacy (shop_id, name) match for rows written before product_id
-- existed — additive, not a rewrite of the join's intent.
create or replace function get_products_with_stats()
returns table (
  id bigint,
  shop_id bigint,
  name text,
  sku text,
  description text,
  price numeric,
  stock_quantity integer,
  created_at timestamptz,
  shop_name text,
  platform text,
  total_orders bigint,
  total_revenue numeric
)
language sql
stable
as $$
  select
    p.id,
    p.shop_id,
    p.name,
    p.sku,
    p.description,
    p.price,
    p.stock_quantity,
    p.created_at,
    s.name as shop_name,
    s.platform,
    count(o.id) as total_orders,
    coalesce(sum(o.price * o.quantity), 0) as total_revenue
  from products p
  left join shops s on s.id = p.shop_id
  left join orders o on o.product_id = p.id
    or (o.product_id is null and o.shop_id = p.shop_id and o.product = p.name)
  group by p.id, p.name, p.sku, p.description, p.price, p.stock_quantity, p.created_at, s.name, s.platform
  order by p.created_at desc;
$$;

grant execute on function get_products_with_stats() to authenticated;

create or replace function get_product_stats()
returns table (
  total_products bigint,
  out_of_stock_products bigint,
  best_selling_product text
)
language sql
stable
as $$
  select
    (select count(*) from products) as total_products,
    (select count(*) from products where coalesce(stock_quantity, 0) <= 0) as out_of_stock_products,
    (
      select p.name
      from products p
      left join orders o on o.product_id = p.id
        or (o.product_id is null and o.shop_id = p.shop_id and o.product = p.name)
      group by p.id, p.name
      order by coalesce(sum(o.quantity), 0) desc
      limit 1
    ) as best_selling_product;
$$;

grant execute on function get_product_stats() to authenticated;

-- Every RLS policy below is redefined identically except auth.uid() is
-- wrapped in a scalar subquery. Per Postgres/Supabase's own RLS performance
-- guidance, "(select auth.uid())" is evaluated once per statement (an
-- initPlan) instead of once per row — same access rules, no behavior
-- change, just faster on any table scan larger than a handful of rows.
drop policy if exists "Users can view their own shops" on shops;
create policy "Users can view their own shops"
  on shops for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their own shops" on shops;
create policy "Users can insert their own shops"
  on shops for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own shops" on shops;
create policy "Users can update their own shops"
  on shops for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own shops" on shops;
create policy "Users can delete their own shops"
  on shops for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can view orders for their own shops" on orders;
create policy "Users can view orders for their own shops"
  on orders for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can update orders for their own shops" on orders;
create policy "Users can update orders for their own shops"
  on orders for update
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())))
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete orders for their own shops" on orders;
create policy "Users can delete orders for their own shops"
  on orders for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can view products for their own shops" on products;
create policy "Users can view products for their own shops"
  on products for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete products for their own shops" on products;
create policy "Users can delete products for their own shops"
  on products for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can view sync history for their own shops" on sync_history;
create policy "Users can view sync history for their own shops"
  on sync_history for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can view order history for their own shops" on order_history;
create policy "Users can view order history for their own shops"
  on order_history for select
  to authenticated
  using (
    order_id in (
      select id from orders where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can record status changes for their own orders" on order_history;
create policy "Users can record status changes for their own orders"
  on order_history for insert
  to authenticated
  with check (
    changed_by = (select auth.uid())
    and order_id in (
      select id from orders where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

-- ==== Workflow Engine (backend only — see the Workflow Engine dossier and
-- Workflow Builder specification for the full design). This phase creates
-- the 3 tables and their RLS; the Workflow Builder UI that lets a merchant
-- populate workflows/workflow_steps through a page is a separate, later
-- phase — the schema is defined now, completely, so that phase needs zero
-- migration changes when it lands (same precedent as sync_history's RLS
-- existing before the Admin Center UI that first read it).

-- User-authored definitions, same direct-ownership model as shops itself —
-- not a system journal like sync_history/order_history.
create table if not exists workflows (
  id bigint generated always as identity primary key,
  shop_id bigint not null references shops(id),
  name text not null,
  trigger_event text not null,
  is_active boolean not null default false,
  -- Nullable: set the first time a workflow becomes Active. UI-only
  -- refinement (distinguishes "never activated" from "deactivated after
  -- running") — the Execution Engine and Workflow Manager never read it.
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workflows_shop_id_idx on workflows (shop_id);
-- The Workflow Manager's one and only query shape: resolve by exactly
-- these 3 columns together (lib/workflows/manager.ts).
create index if not exists workflows_shop_trigger_active_idx
  on workflows (shop_id, trigger_event, is_active);

alter table workflows enable row level security;

create table if not exists workflow_steps (
  id bigint generated always as identity primary key,
  workflow_id bigint not null references workflows(id) on delete cascade,
  step_order integer not null,
  module_name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Guarantees no two steps of the same workflow can ever share a position,
-- even from a double-submitted reorder — and, per the Workflow Builder
-- specification's audit note, on delete cascade is set from this table's
-- very first migration (unlike sync_history/order_history originally,
-- where its absence broke shop deletion).
create unique index if not exists workflow_steps_workflow_order_key
  on workflow_steps (workflow_id, step_order);

alter table workflow_steps enable row level security;

-- One row per step *attempt*, written exclusively by the Execution Engine
-- (lib/workflows/execution-history.ts) — flat, not normalized into a
-- separate "executions" + "steps" pair, calqued directly on sync_history.
create table if not exists workflow_executions (
  id bigint generated always as identity primary key,
  workflow_id bigint not null references workflows(id) on delete cascade,
  order_id bigint not null references orders(id),
  step_order integer not null,
  module_name text not null,
  status text not null check (status in ('success', 'failed')),
  message text,
  duration_ms integer not null,
  started_at timestamptz not null
);

create index if not exists workflow_executions_workflow_id_idx on workflow_executions (workflow_id);
create index if not exists workflow_executions_order_id_idx on workflow_executions (order_id);
create index if not exists workflow_executions_started_at_idx on workflow_executions (started_at desc);

alter table workflow_executions enable row level security;

-- workflows/workflow_steps are user-writable (a merchant's own definitions,
-- once the Builder UI exists) — same grant shape as shops. workflow_executions
-- is select-only for `authenticated`, same split as sync_history: only the
-- service-role client (the Execution Engine) ever writes it.
grant select, insert, update, delete on workflows to authenticated;
grant select, insert, update, delete on workflow_steps to authenticated;
grant select on workflow_executions to authenticated;

drop policy if exists "Users can view their own workflows" on workflows;
create policy "Users can view their own workflows"
  on workflows for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can insert their own workflows" on workflows;
create policy "Users can insert their own workflows"
  on workflows for insert
  to authenticated
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can update their own workflows" on workflows;
create policy "Users can update their own workflows"
  on workflows for update
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())))
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete their own workflows" on workflows;
create policy "Users can delete their own workflows"
  on workflows for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

-- workflow_steps: scoped transitively via workflow_id -> workflows.shop_id
-- -> user_id, same chain shape as order_history's order_id -> orders.shop_id
-- -> user_id.
drop policy if exists "Users can view steps for their own workflows" on workflow_steps;
create policy "Users can view steps for their own workflows"
  on workflow_steps for select
  to authenticated
  using (
    workflow_id in (
      select id from workflows where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can insert steps for their own workflows" on workflow_steps;
create policy "Users can insert steps for their own workflows"
  on workflow_steps for insert
  to authenticated
  with check (
    workflow_id in (
      select id from workflows where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can update steps for their own workflows" on workflow_steps;
create policy "Users can update steps for their own workflows"
  on workflow_steps for update
  to authenticated
  using (
    workflow_id in (
      select id from workflows where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  )
  with check (
    workflow_id in (
      select id from workflows where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can delete steps for their own workflows" on workflow_steps;
create policy "Users can delete steps for their own workflows"
  on workflow_steps for delete
  to authenticated
  using (
    workflow_id in (
      select id from workflows where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

-- workflow_executions: read-only for users, matching sync_history's policy
-- exactly.
drop policy if exists "Users can view executions for their own workflows" on workflow_executions;
create policy "Users can view executions for their own workflows"
  on workflow_executions for select
  to authenticated
  using (
    workflow_id in (
      select id from workflows where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

-- ==== First production Automation Modules ====
-- See the Automation Modules catalog's own "Implications de schéma" summary
-- — everything below is additive (new tables, or nullable columns on
-- orders), nothing here changes an existing column's meaning.

-- Per-shop credentials for modules that call an external API (WhatsApp,
-- Delivery, Email, SMS, ERP, CRM, AI Agent — Slack and Webhook instead
-- take their destination URL as per-step config, since a webhook URL
-- already scopes itself to one workspace/channel, unlike an API key;
-- ERP/CRM's endpoint is likewise per-step config, with only an optional
-- API key here). Configured once per shop, not re-entered per workflow step — the same principle
-- already applied to platform credentials (shops.api_key/api_secret).
-- credentials is opaque JSON: its shape is entirely up to the module that
-- reads it, so adding a field to one module's credentials never needs a
-- migration. No UI writes this table yet (no module credentials settings
-- page exists) — rows are provisioned by hand until that UI is built; the
-- schema and RLS are complete now regardless, same precedent as
-- sync_history's RLS predating the Admin Center that first read it.
create table if not exists module_credentials (
  id bigint generated always as identity primary key,
  shop_id bigint not null references shops(id),
  module_name text not null,
  credentials jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The only lookup shape any module ever uses (shop_id + its own module
-- name together) — also enforces one credentials row per shop per module.
create unique index if not exists module_credentials_shop_module_key
  on module_credentials (shop_id, module_name);

alter table module_credentials enable row level security;

grant select, insert, update, delete on module_credentials to authenticated;

drop policy if exists "Users can view credentials for their own shops" on module_credentials;
create policy "Users can view credentials for their own shops"
  on module_credentials for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can insert credentials for their own shops" on module_credentials;
create policy "Users can insert credentials for their own shops"
  on module_credentials for insert
  to authenticated
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can update credentials for their own shops" on module_credentials;
create policy "Users can update credentials for their own shops"
  on module_credentials for update
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())))
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete credentials for their own shops" on module_credentials;
create policy "Users can delete credentials for their own shops"
  on module_credentials for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

-- Email/CRM modules — nullable, additive, no rupture for existing rows.
alter table orders add column if not exists customer_email text;

-- Tag Order module. A plain array column is enough for v1 — a separate
-- order_tags table only earns its keep once tags need their own metadata
-- (color, permissions), per the catalog.
alter table orders add column if not exists tags text[] not null default '{}';

-- Archive module. Not called out in the catalog's own schema-impact table,
-- but the module needs somewhere to record its result — a nullable
-- timestamp (set once, on archive) follows the same pattern as
-- sheet_regenerated_at/credentials_changed_at elsewhere in this file,
-- rather than overloading orders.status (a closed, unrelated 6-value
-- vocabulary) or orders.tags (merchant-defined labels, not system state).
alter table orders add column if not exists archived_at timestamptz;

-- Notes module. A dedicated table, not a reuse of workflow_executions.message
-- — a note is a human-facing annotation, not a technical execution log.
-- on delete cascade from creation, same reasoning as workflow_steps.
create table if not exists order_notes (
  id bigint generated always as identity primary key,
  order_id bigint not null references orders(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_notes_order_id_idx on order_notes (order_id);

alter table order_notes enable row level security;

-- Select-only for `authenticated`, matching sync_history/workflow_executions
-- — only the Notes module (service-role) ever writes this table; no
-- user-facing "add a note by hand" UI exists yet.
grant select on order_notes to authenticated;

drop policy if exists "Users can view notes for their own orders" on order_notes;
create policy "Users can view notes for their own orders"
  on order_notes for select
  to authenticated
  using (
    order_id in (
      select id from orders where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

-- ==== Workflow Engine integration into Admin Center ====
-- Both functions below mirror get_shops_with_stats()/get_sync_performance_stats()
-- exactly — same shape, same reasoning — applied to workflows/workflow_executions
-- instead of shops/sync_history. No new tables, no new columns: everything
-- here is an aggregate over data that already exists.

-- Backs Workflow Statistics — one row per workflow with its shop, trigger,
-- step count, and step-execution stats. "Execution" here means a logged
-- step attempt (workflow_executions is one row per step, same granularity
-- sync_history uses per sync attempt) — there's no separate "workflow run"
-- row to count instead, so success_rate is a step-level rate, not a
-- whole-run rate.
create or replace function get_workflows_with_stats()
returns table (
  id bigint,
  shop_id bigint,
  shop_name text,
  name text,
  trigger_event text,
  is_active boolean,
  step_count bigint,
  execution_count bigint,
  success_count bigint,
  failure_count bigint,
  avg_duration_ms numeric,
  last_execution_at timestamptz,
  last_execution_status text,
  created_at timestamptz
)
language sql
stable
as $$
  with step_counts as (
    select workflow_id, count(*) as step_count
    from workflow_steps
    group by workflow_id
  ),
  execution_stats as (
    select
      workflow_id,
      count(*) as execution_count,
      count(*) filter (where status = 'success') as success_count,
      count(*) filter (where status = 'failed') as failure_count,
      avg(duration_ms) as avg_duration_ms
    from workflow_executions
    group by workflow_id
  )
  select
    w.id,
    w.shop_id,
    s.name as shop_name,
    w.name,
    w.trigger_event,
    w.is_active,
    coalesce(sc.step_count, 0) as step_count,
    coalesce(es.execution_count, 0) as execution_count,
    coalesce(es.success_count, 0) as success_count,
    coalesce(es.failure_count, 0) as failure_count,
    es.avg_duration_ms,
    -- Same fix as get_shops_with_stats()'s last_sync fields: one LATERAL
    -- join finds the most recent workflow_executions row once, instead of
    -- two separate correlated subqueries each re-finding that same row to
    -- read a different column off it.
    last_execution.started_at as last_execution_at,
    last_execution.status as last_execution_status,
    w.created_at
  from workflows w
  left join shops s on s.id = w.shop_id
  left join step_counts sc on sc.workflow_id = w.id
  left join execution_stats es on es.workflow_id = w.id
  left join lateral (
    select we.started_at, we.status
    from workflow_executions we
    where we.workflow_id = w.id
    order by we.started_at desc
    limit 1
  ) last_execution on true
  order by w.created_at desc;
$$;

grant execute on function get_workflows_with_stats() to authenticated;

-- Backs Workflow Performance — the one aggregate nothing else computes,
-- same role get_sync_performance_stats() plays for synchronization.
create or replace function get_workflow_performance_stats()
returns table (
  avg_duration_ms numeric,
  max_duration_ms integer,
  min_duration_ms integer,
  success_rate numeric,
  total_executions bigint
)
language sql
stable
as $$
  select
    coalesce(avg(duration_ms), 0) as avg_duration_ms,
    coalesce(max(duration_ms), 0) as max_duration_ms,
    coalesce(min(duration_ms), 0) as min_duration_ms,
    coalesce(
      round(100.0 * count(*) filter (where status = 'success') / nullif(count(*), 0), 1),
      0
    ) as success_rate,
    count(*) as total_executions
  from workflow_executions;
$$;

grant execute on function get_workflow_performance_stats() to authenticated;

-- ==== Production hardening ====

-- Backs lib/workflows/circuit-breaker.ts's isCircuitOpen(): "the last N
-- attempts of this exact step, newest first" — filters on
-- (workflow_id, step_order) together and orders by started_at, so a plain
-- index on workflow_id alone (already existing) would still need to sort
-- every row for that workflow at query time as it grows. This composite
-- index lets Postgres satisfy the filter and the ordering from the index
-- alone.
create index if not exists workflow_executions_workflow_step_idx
  on workflow_executions (workflow_id, step_order, started_at desc);

-- ==== Final review fixes ====

-- deleteShop() (app/shops/actions.ts) only ever explicitly deletes orders
-- and products before the shop itself — that was correct when it was
-- written, but 5 tables added since (sync_history, workflows,
-- module_credentials, order_history, workflow_executions) reference
-- shops.id or orders.id with no cascade, so deleting a shop that has ever
-- synced, or has a workflow, or has an order with any status history,
-- fails with a foreign key violation. Rather than teach deleteShop() to
-- explicitly delete from 5 more tables in the right order (more
-- application code, more places to get the order wrong, and still no
-- protection against a network failure between steps), the database does
-- the transitive cleanup itself — deleteShop() stays exactly the 3 steps
-- it already is.
--
-- Postgres names an inline "references" constraint "<table>_<column>_fkey"
-- when no explicit name is given, which is how every one of these was
-- declared — drop-then-add is the idempotent way to change an existing
-- constraint's ON DELETE behavior (there's no "alter constraint" for this).
alter table sync_history drop constraint if exists sync_history_shop_id_fkey;
alter table sync_history add constraint sync_history_shop_id_fkey
  foreign key (shop_id) references shops(id) on delete cascade;

alter table workflows drop constraint if exists workflows_shop_id_fkey;
alter table workflows add constraint workflows_shop_id_fkey
  foreign key (shop_id) references shops(id) on delete cascade;

alter table module_credentials drop constraint if exists module_credentials_shop_id_fkey;
alter table module_credentials add constraint module_credentials_shop_id_fkey
  foreign key (shop_id) references shops(id) on delete cascade;

alter table order_history drop constraint if exists order_history_order_id_fkey;
alter table order_history add constraint order_history_order_id_fkey
  foreign key (order_id) references orders(id) on delete cascade;

alter table workflow_executions drop constraint if exists workflow_executions_order_id_fkey;
alter table workflow_executions add constraint workflow_executions_order_id_fkey
  foreign key (order_id) references orders(id) on delete cascade;

-- order_history.changed_by (uuid, references auth.users(id)) had no
-- supporting index — every other foreign key column in this schema does.
create index if not exists order_history_changed_by_idx on order_history (changed_by);

-- ==== Architecture review fixes ====

-- Circuit breaker's isCircuitOpen() (lib/workflows/circuit-breaker.ts)
-- filters on (workflow_id, step_order, module_name) together — the
-- composite index added during the earlier hardening phase only covered
-- (workflow_id, step_order, started_at desc), predating module_name being
-- added to that query to fix the circuit breaker identity bug. Replacing
-- it with a version that includes module_name lets Postgres satisfy the
-- entire filter from the index alone instead of scanning every row for a
-- (workflow_id, step_order) pair and checking module_name as a residual
-- predicate on each one.
drop index if exists workflow_executions_workflow_step_idx;
create index if not exists workflow_executions_workflow_step_module_idx
  on workflow_executions (workflow_id, step_order, module_name, started_at desc);

-- orders.shop_id / products.shop_id are set by every current write path
-- (the webhook, platform sync) and never left null in practice, but the
-- column itself still allowed it — a row that ever ended up with a null
-- shop_id would be invisible under every RLS policy that scopes via
-- "shop_id in (select id from shops where user_id = ...)" (Postgres's
-- "NULL IN (...)" is NULL, never true), recoverable only via the
-- service-role client. Promoting the existing application invariant to a
-- real constraint turns that silent, hard-to-diagnose data-loss scenario
-- into an immediate, loud insert-time error instead.
--
-- If either statement below ever fails on an existing database, it means
-- a row with a null shop_id genuinely exists and needs manual
-- investigation (assign it to the correct shop, or delete it if orphaned)
-- before this constraint can be applied — do not work around that by
-- relaxing this back to nullable.
alter table orders alter column shop_id set not null;
alter table products alter column shop_id set not null;

-- ==== Per-shop webhook secret ====
-- POST /api/orders previously trusted a single global API_SECRET shared by
-- every shop's Google Apps Script deployment, with the request's shop
-- resolved purely from client-supplied sheet_id — meaning anyone who has
-- (or leaks, or guesses) that one secret can write orders against any shop
-- whose sheet_id they know, or create unlimited new phantom shops by
-- omitting sheet_id entirely (a null sheet_id never collides with another
-- null under the unique index). This column gives each shop its own
-- secret as an additive, backward-compatible alternative:
-- app/api/orders/route.ts tries matching x-api-key against a shop's own
-- webhook_secret first, and only falls back to the global API_SECRET +
-- sheet_id resolution (unchanged) when no shop matches — so every existing
-- Apps Script deployment using the old shared secret keeps working exactly
-- as before with zero action required, while a shop that switches its Apps
-- Script to send its own webhook_secret gets a hard per-tenant boundary
-- instead of a shared one.
--
-- Generated from 2 concatenated gen_random_uuid() calls (unique,
-- unguessable, 244 bits of randomness) — built entirely from PostgreSQL's
-- own core, no pgcrypto/extension dependency. For a volatile default like
-- this, "add column" backfills every existing row with its own
-- freshly-generated value (not one value computed once and shared), so
-- every pre-existing shop gets a real, distinct secret too.
alter table shops add column if not exists webhook_secret text unique
  default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

-- get_shops_with_stats() improved further: last_success_sync_at/
-- last_failed_sync_at were 2 separate correlated subqueries each scanning
-- sync_history for this shop; last_products_imported_count/
-- last_orders_imported_count were 2 more. Same fix as the last_sync
-- LATERAL added during the earlier hardening phase — group each pair into
-- one LATERAL that computes both columns from a single scan, using FILTER
-- for the success/failure split and DISTINCT ON (per type) + FILTER for
-- the per-type latest imported_count. Output is identical; this only
-- changes how many times sync_history is scanned per shop row (5 separate
-- lookups before this file's changes, 3 LATERAL joins now).
create or replace function get_shops_with_stats()
returns table (
  id bigint,
  name text,
  platform text,
  sheet_id text,
  sheet_name text,
  store_url text,
  sync_frequency text,
  last_sync_attempt_at timestamptz,
  last_sync_status text,
  last_success_sync_at timestamptz,
  last_failed_sync_at timestamptz,
  last_sync_duration_ms integer,
  last_sync_message text,
  last_products_imported_count integer,
  last_orders_imported_count integer,
  currency text,
  timezone text,
  sync_products_enabled boolean,
  sync_orders_enabled boolean,
  auto_sync_enabled boolean,
  email_notifications_enabled boolean,
  created_at timestamptz,
  product_count bigint,
  order_count bigint,
  total_revenue numeric
)
language sql
stable
as $$
  with product_counts as (
    select shop_id, count(*) as product_count
    from products
    group by shop_id
  ),
  order_stats as (
    select shop_id, count(*) as order_count, coalesce(sum(price * quantity), 0) as total_revenue
    from orders
    group by shop_id
  )
  select
    s.id,
    s.name,
    s.platform,
    s.sheet_id,
    s.sheet_name,
    s.store_url,
    s.sync_frequency,
    s.last_sync_attempt_at,
    last_sync.status as last_sync_status,
    sync_success_stats.last_success_sync_at,
    sync_success_stats.last_failed_sync_at,
    last_sync.duration_ms as last_sync_duration_ms,
    last_sync.message as last_sync_message,
    latest_import_counts.last_products_imported_count,
    latest_import_counts.last_orders_imported_count,
    s.currency,
    s.timezone,
    s.sync_products_enabled,
    s.sync_orders_enabled,
    s.auto_sync_enabled,
    s.email_notifications_enabled,
    s.created_at,
    coalesce(pc.product_count, 0) as product_count,
    coalesce(os.order_count, 0) as order_count,
    coalesce(os.total_revenue, 0) as total_revenue
  from shops s
  left join product_counts pc on pc.shop_id = s.id
  left join order_stats os on os.shop_id = s.id
  left join lateral (
    select sh.status, sh.duration_ms, sh.message
    from sync_history sh
    where sh.shop_id = s.id
    order by sh.started_at desc
    limit 1
  ) last_sync on true
  left join lateral (
    select
      max(sh.started_at) filter (where sh.status = 'success') as last_success_sync_at,
      max(sh.started_at) filter (where sh.status = 'failed') as last_failed_sync_at
    from sync_history sh
    where sh.shop_id = s.id
  ) sync_success_stats on true
  left join lateral (
    select
      max(latest.imported_count) filter (where latest.type = 'products') as last_products_imported_count,
      max(latest.imported_count) filter (where latest.type = 'orders') as last_orders_imported_count
    from (
      select distinct on (sh.type) sh.type, sh.imported_count
      from sync_history sh
      where sh.shop_id = s.id
      order by sh.type, sh.started_at desc
    ) latest
  ) latest_import_counts on true
  order by s.created_at desc;
$$;

grant execute on function get_shops_with_stats() to authenticated;

-- ==== Automation retry / resume ====
-- See lib/workflows/resume.ts and lib/workflows/retry.ts.

-- Backs getBackoffEligiblePairs()'s recurring scan for recent failures
-- (status = 'failed' and started_at >= some rolling window) — run
-- automatically every 5 minutes forever by the automation-retry cron, and
-- once per click by the Admin Center's manual "Retry Failed Executions".
-- Before this, that query could only use the single-column started_at
-- index and filter status as a residual predicate; workflow_executions is
-- explicitly unbounded (an append-only log with no cleanup job), so a scan
-- that degrades with total table size rather than with the size of the
-- actual failure backlog is worth avoiding on a query this frequent.
create index if not exists workflow_executions_status_started_at_idx
  on workflow_executions (status, started_at desc);

-- One row per pending pause requested by a "waiting" ModuleResult.outcome
-- (Delay today; any future module that returns "waiting" tomorrow) — a
-- dedicated table, not new columns on workflow_executions. That table is an
-- append-only per-step attempt *log*; a pending wait is the opposite shape,
-- a single mutable record that gets consumed once, so mixing the two would
-- overload workflow_executions.status (currently a strict success/failed
-- CHECK) with a third, structurally different meaning. Rows are never
-- deleted, only marked consumed_at — same "keep the audit trail" precedent
-- as sync_history/workflow_executions, both of which have no cleanup job
-- either.
create table if not exists workflow_waits (
  id bigint generated always as identity primary key,
  workflow_id bigint not null references workflows(id) on delete cascade,
  order_id bigint not null references orders(id) on delete cascade,
  -- The step to resume AT (not the step that requested the wait) — a
  -- stable id, not the step_order that was current when the wait was
  -- created. step_order is reassigned by moveWorkflowStepUp/Down and
  -- renumberSteps (see circuit-breaker.ts's own comment on the exact same
  -- instability), and a workflow stays editable while a wait is pending —
  -- resuming by a snapshotted step_order could land on a completely
  -- different step than the one that actually requested the pause.
  -- Nullable, set null on delete: if the target step is removed before the
  -- wait becomes due, the resume cron detects that (rather than resuming
  -- into whatever step was renumbered into its old position) and gives up
  -- on that one pause instead of silently running the wrong step.
  resume_step_id bigint references workflow_steps(id) on delete set null,
  -- WorkflowContext accumulated up to and including the waiting step's own
  -- result.data, so a step after the resume point can still read what an
  -- earlier step produced, exactly as if the run had never paused.
  context jsonb not null default '{}'::jsonb,
  resume_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Doubles as the idempotency guard: the resume cron only claims a row by
  -- updating this from null to now() with an `is null` predicate in the
  -- same statement (optimistic concurrency, same shape as
  -- swapStepOrder()'s sentinel-park technique) — two overlapping cron
  -- invocations can both select the same due row, but only one can win the
  -- claim, so a workflow is never resumed twice from the same pause.
  consumed_at timestamptz
);

create index if not exists workflow_waits_due_idx
  on workflow_waits (resume_at) where consumed_at is null;
create index if not exists workflow_waits_workflow_id_idx on workflow_waits (workflow_id);
create index if not exists workflow_waits_order_id_idx on workflow_waits (order_id);

alter table workflow_waits enable row level security;

-- Select-only for `authenticated`, same split as workflow_executions: only
-- the service-role client (the resume cron) ever writes this table.
grant select on workflow_waits to authenticated;

drop policy if exists "Users can view waits for their own workflows" on workflow_waits;
create policy "Users can view waits for their own workflows"
  on workflow_waits for select
  to authenticated
  using (
    workflow_id in (
      select id from workflows where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

-- ==== Google OAuth (per-user Google account connection) ====
-- One row per app user who has connected their own Google account. Replaces
-- the single shared service account previously used by lib/google-sheets.ts
-- (google.auth.JWT), which failed for any real, non-Workspace Gmail user
-- with "The user's Drive storage quota has been exceeded" — a service
-- account has 0 bytes of its own Drive storage, and drive.files.copy()
-- always creates the copy owned by the caller. Every spreadsheet is now
-- provisioned inside the connecting user's own Drive via their OAuth
-- refresh token, stored here encrypted at rest (see lib/crypto.ts).
--
-- Written by app/api/google/callback/route.ts using the service-role client
-- (lib/supabase.ts), not the RLS-scoped one: that route is a redirect from
-- google.com, not a same-origin form submission, so it shouldn't depend on
-- the session cookie surviving that hop.
create table if not exists google_accounts (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id),
  google_email text not null,
  -- AES-256-GCM ciphertext (iv + authTag + ciphertext, base64), never the
  -- raw token. Only the refresh token needs to persist — access tokens are
  -- short-lived and googleapis' OAuth2 client fetches a fresh one on demand
  -- once the refresh token is set as a credential.
  encrypted_refresh_token text not null,
  -- Cached short-lived access token + its expiry, purely an optimization
  -- (skip a refresh round-trip when still valid) — never relied on as the
  -- source of truth, encrypted_refresh_token is.
  access_token text,
  access_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists google_accounts_user_id_idx on google_accounts (user_id);

alter table google_accounts enable row level security;

grant select, insert, update, delete on google_accounts to authenticated;

drop policy if exists "Users can view their own google account" on google_accounts;
create policy "Users can view their own google account"
  on google_accounts for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their own google account" on google_accounts;
create policy "Users can insert their own google account"
  on google_accounts for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own google account" on google_accounts;
create policy "Users can update their own google account"
  on google_accounts for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own google account" on google_accounts;
create policy "Users can delete their own google account"
  on google_accounts for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ==== Customers ====
-- One row per (shop_id, phone) — phone is the identity key because it's
-- the one customer field every order ingestion path already collects
-- (apps-script/sync-orders.gs's COL layout), unlike email (see the
-- "customer_email" work — still frequently absent). `not null` from the
-- start, unlike shops.sheet_id's history: there is no existing data where
-- phone was ever optional, so the (shop_id, phone) unique constraint
-- below is safe to rely on directly — no NULL-collision workaround
-- needed the way lib/shop.ts's createOrUpdateShop() requires for
-- sheet_id. lib/customer.ts's createOrUpdateCustomer() is the only writer.
--
-- Only a light trim() is applied to phone by the application, not full
-- E.164 normalization — two representations of the same real number
-- ("0600000000" vs "+212600000000") are treated as different customers
-- today. A known, scoped-out limitation, not an oversight.
create table if not exists customers (
  id bigint generated always as identity primary key,
  shop_id bigint not null references shops(id) on delete cascade,
  phone text not null,
  name text,
  email text,
  city text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customers_shop_phone_key
  on customers (shop_id, phone);

create index if not exists customers_shop_id_idx on customers (shop_id);

-- Nullable and unenforced by a foreign key check at insert time by
-- design: an order predating this feature, or one whose payload had no
-- phone at all, simply has no linked customer — same "best effort,
-- never blocks the order" posture as orders.product_id.
alter table orders add column if not exists customer_id bigint references customers(id);

create index if not exists orders_customer_id_idx on orders (customer_id);

alter table customers enable row level security;

grant select, insert, update, delete on customers to authenticated;

drop policy if exists "Users can view customers for their own shops" on customers;
create policy "Users can view customers for their own shops"
  on customers for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can insert customers for their own shops" on customers;
create policy "Users can insert customers for their own shops"
  on customers for insert
  to authenticated
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can update customers for their own shops" on customers;
create policy "Users can update customers for their own shops"
  on customers for update
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())))
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete customers for their own shops" on customers;
create policy "Users can delete customers for their own shops"
  on customers for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

-- Per-customer order count/LTV/last order — the one aggregate a future
-- customer detail view needs, same "language sql stable" shape as every
-- other read-only aggregate function in this file (get_dashboard_stats,
-- get_product_stats...). Not called anywhere in the application yet —
-- same precedent as module_credentials' RLS predating the UI that first
-- wrote to it: the schema is complete now regardless of what reads it
-- first.
create or replace function get_customer_stats(p_customer_id bigint)
returns table (
  order_count bigint,
  ltv numeric,
  last_order_at timestamptz
)
language sql
stable
as $$
  select
    count(*),
    coalesce(sum(price * quantity), 0),
    max(created_at)
  from orders
  where customer_id = p_customer_id;
$$;

-- ==== Stock decrement on order creation ====
-- A real UPDATE ... WHERE, not a read-then-write from the application —
-- supabase-js's query builder has no way to express "set this column to
-- itself minus N" as a single atomic statement, and reading the current
-- value in app code first would reopen exactly the kind of lost-update
-- race already fixed elsewhere in this schema (see createOrUpdateShop's
-- own history). A single UPDATE lets Postgres's own row lock serialize
-- concurrent orders against the same product correctly.
--
-- Only touches a row whose stock_quantity is already a real number —
-- NULL means "not tracked for this product" (never synced from a
-- platform), and this function leaves that meaning alone rather than
-- silently turning "unknown" into "zero". Clamped at 0 rather than going
-- negative: a backorder/oversell scenario is out of scope here, this is
-- a display number, not an inventory reservation system.
create or replace function decrement_product_stock(p_product_id bigint, p_quantity integer)
returns void
language sql
as $$
  update products
  set stock_quantity = greatest(stock_quantity - p_quantity, 0)
  where id = p_product_id and stock_quantity is not null;
$$;

-- ==== Product variants ====
-- Storage only, populated exclusively by the direct platform pull
-- (lib/sync.ts's syncShopProducts, Flux 2) — the Google Sheets order
-- pipeline carries no variant information at all (no SKU/variant column
-- anywhere in apps-script/sync-orders.gs), so there is nothing here to
-- link an incoming order to a specific variant. That would require
-- changing what the Sheet/Apps Script collect, a separate, larger piece
-- of work, deliberately out of scope here.
--
-- Populated by the Shopify connector only for now (lib/platforms/
-- shopify.ts embeds every variant directly in its product list
-- response, so capturing all of them instead of just variants[0] is a
-- pure mapping change). WooCommerce exposes variations through a
-- separate, paginated per-product endpoint — a real fetch-pattern change,
-- not just a mapping one — and YouCan's connector is already documented
-- as unverified, best-effort guesswork with no confirmed variant model
-- at all (see lib/platforms/youcan.ts's own header comment). Extending
-- either without a real API to verify against would mean inventing
-- behavior, not implementing it. Both are follow-up work.
create table if not exists product_variants (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete cascade,
  platform_variant_id text not null,
  title text,
  sku text,
  price numeric(10, 2),
  stock_quantity integer,
  created_at timestamptz not null default now()
);

create unique index if not exists product_variants_product_platform_key
  on product_variants (product_id, platform_variant_id);

create index if not exists product_variants_product_id_idx on product_variants (product_id);

alter table product_variants enable row level security;

grant select, insert, update, delete on product_variants to authenticated;

drop policy if exists "Users can view variants for their own products" on product_variants;
create policy "Users can view variants for their own products"
  on product_variants for select
  to authenticated
  using (
    product_id in (
      select id from products where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can insert variants for their own products" on product_variants;
create policy "Users can insert variants for their own products"
  on product_variants for insert
  to authenticated
  with check (
    product_id in (
      select id from products where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can update variants for their own products" on product_variants;
create policy "Users can update variants for their own products"
  on product_variants for update
  to authenticated
  using (
    product_id in (
      select id from products where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  )
  with check (
    product_id in (
      select id from products where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can delete variants for their own products" on product_variants;
create policy "Users can delete variants for their own products"
  on product_variants for delete
  to authenticated
  using (
    product_id in (
      select id from products where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

-- ==== Promo codes ====
-- Written by lib/automation-modules/promo-code.ts as a retention/marketing
-- action — not applied at checkout, since OrderHub never sees or controls
-- the merchant's platform checkout. "Redeemed" is deliberately not
-- tracked: nothing in this pipeline (Sheets/webhook payload) ever reports
-- a promo code back, so this table only records that a code was issued,
-- never whether it was actually used.
create table if not exists promo_codes (
  id bigint generated always as identity primary key,
  shop_id bigint not null references shops(id) on delete cascade,
  -- Nullable: a promo code can be generated for an order whose customer
  -- couldn't be resolved (no phone on the order — see customers table's
  -- own comment), same "best effort, never blocks" posture as
  -- orders.customer_id.
  customer_id bigint references customers(id) on delete set null,
  code text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(10, 2) not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists promo_codes_shop_code_key on promo_codes (shop_id, code);

create index if not exists promo_codes_shop_id_idx on promo_codes (shop_id);
create index if not exists promo_codes_customer_id_idx on promo_codes (customer_id);

alter table promo_codes enable row level security;

grant select, insert, update, delete on promo_codes to authenticated;

drop policy if exists "Users can view promo codes for their own shops" on promo_codes;
create policy "Users can view promo codes for their own shops"
  on promo_codes for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can insert promo codes for their own shops" on promo_codes;
create policy "Users can insert promo codes for their own shops"
  on promo_codes for insert
  to authenticated
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can update promo codes for their own shops" on promo_codes;
create policy "Users can update promo codes for their own shops"
  on promo_codes for update
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())))
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete promo codes for their own shops" on promo_codes;
create policy "Users can delete promo codes for their own shops"
  on promo_codes for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

-- ==== Invoices ====
-- Written by lib/automation-modules/invoice.ts. The invoice number is
-- derived from this table's own identity column (formatted as
-- "INV-000123"), not a separate per-shop counter — a per-shop counter
-- restarting at 1 would need a "select max(number)+1" read-then-write,
-- reopening exactly the lost-update race already fixed elsewhere in this
-- schema (createOrUpdateShop's own history). A single global identity
-- column is atomic by construction, at the cost of gaps/no-restart-at-1
-- per shop — a deliberate simplicity trade-off, not an oversight.
--
-- One row per order at most in practice (the module is only ever run
-- once per order in a given workflow run), but nothing here enforces
-- that — a merchant could reference the Invoice module twice in the same
-- workflow, or across a retried run, and get two invoice numbers for the
-- same order. Out of scope to prevent today.
create table if not exists invoices (
  id bigint generated always as identity primary key,
  shop_id bigint not null references shops(id) on delete cascade,
  order_id bigint references orders(id) on delete set null,
  customer_id bigint references customers(id) on delete set null,
  amount numeric(10, 2) not null,
  currency text not null default 'USD',
  issued_at timestamptz not null default now()
);

create index if not exists invoices_shop_id_idx on invoices (shop_id);
create index if not exists invoices_order_id_idx on invoices (order_id);

alter table invoices enable row level security;

grant select, insert, update, delete on invoices to authenticated;

drop policy if exists "Users can view invoices for their own shops" on invoices;
create policy "Users can view invoices for their own shops"
  on invoices for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can insert invoices for their own shops" on invoices;
create policy "Users can insert invoices for their own shops"
  on invoices for insert
  to authenticated
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can update invoices for their own shops" on invoices;
create policy "Users can update invoices for their own shops"
  on invoices for update
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())))
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete invoices for their own shops" on invoices;
create policy "Users can delete invoices for their own shops"
  on invoices for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

-- ===========================================================================
-- AI Commerce Agent — conversational sales agent per shop (schema only; the
-- engine, providers, RAG, and WhatsApp webhook that populate these tables
-- arrive in later phases). See the Phase 1 architecture doc for the full
-- design; this migration only creates what Phases 3-8 actually need —
-- agent_actions_log and support_tickets are deliberately deferred to the
-- Tool Calling phase that gives them something real to log, same "add a
-- table with the feature that uses it" discipline as customers/
-- product_variants/promo_codes/invoices above.
-- ===========================================================================

-- One row per shop's agent configuration — 1:1 with shops (a shop either has
-- an agent configured or doesn't). The provider's own API key lives in
-- module_credentials under module_name 'ai-sales-agent', deliberately not
-- 'ai-agent' — that name is already taken by the existing single-turn
-- classification module (lib/automation-modules/ai-agent.ts); reusing it
-- here would silently overwrite that module's own Anthropic credentials the
-- first time either one is saved.
create table if not exists ai_agents (
  id bigint generated always as identity primary key,
  shop_id bigint not null references shops(id) on delete cascade,
  is_active boolean not null default false,
  system_prompt text,
  tone text not null default 'friendly' check (tone in ('friendly', 'professional', 'casual', 'formal')),
  -- 'ar-ma' = Darija (Moroccan Arabic). Latin-script vs Arabic-script Darija
  -- is a prompting concern, not a data-modeling one, so it isn't split here.
  languages text[] not null default array['fr', 'en', 'ar-ma'],
  ai_provider text not null default 'openrouter',
  ai_model text,
  -- Explicit opt-in whitelist, empty by default (see Phase 1 doc §6) — no
  -- CHECK against a fixed tool list here, since that list grows in Phase 9
  -- and belongs to application code (lib/agent/tools.ts), not a migration.
  enabled_tools text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_agents_shop_id_key on ai_agents (shop_id);

-- Phase 8 (RAG): two per-shop tuning knobs, both nullable-or-defaulted so
-- every existing row stays valid without a backfill. rag_enabled defaults
-- false — a shop must opt in, same posture as is_active for the agent
-- itself; retrieval never becomes "free" background cost for a shop that
-- never configured any documents. rag_top_k is nullable, not defaulted
-- here: null means "use the platform-wide default" (a code-level constant,
-- lib/agent/rag/retriever.ts), not a magic number baked into every row at
-- creation time — the whole point of this column existing at all is to let
-- a shop override that default without a code change, not to duplicate it.
-- The embedding provider/model themselves are deliberately NOT per-shop
-- columns here: agent_document_chunks.embedding is a single fixed-dimension
-- vector(768) column shared by every shop, so the model that fills it must
-- be a platform-wide choice, never one a shop can independently switch —
-- see the Phase 8 Étape 8.0 architecture analysis for why.
alter table ai_agents add column if not exists rag_enabled boolean not null default false;
alter table ai_agents add column if not exists rag_top_k integer;

alter table ai_agents enable row level security;

grant select, insert, update, delete on ai_agents to authenticated;

drop policy if exists "Users can view their own shop's AI agent" on ai_agents;
create policy "Users can view their own shop's AI agent"
  on ai_agents for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can insert their own shop's AI agent" on ai_agents;
create policy "Users can insert their own shop's AI agent"
  on ai_agents for insert
  to authenticated
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can update their own shop's AI agent" on ai_agents;
create policy "Users can update their own shop's AI agent"
  on ai_agents for update
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())))
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete their own shop's AI agent" on ai_agents;
create policy "Users can delete their own shop's AI agent"
  on ai_agents for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

-- One thread per (shop, channel, external identifier) — e.g. one row per
-- WhatsApp wa_id per shop. Written exclusively by the inbound webhook
-- (Phase 8) and the agent engine (Phase 5), both server-side with no
-- Supabase session of their own (the webhook has no logged-in user at all)
-- — same "service-role writes, authenticated only reads" split already used
-- for workflow_executions/sync_history/order_notes below.
create table if not exists agent_conversations (
  id bigint generated always as identity primary key,
  shop_id bigint not null references shops(id) on delete cascade,
  customer_id bigint references customers(id),
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'console')),
  external_thread_id text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'escalated')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 'console' (Étape "mode finalisation" — internal test/demo console,
-- app/shops/[id]/agent/console) added after 'whatsapp' was the only value
-- for a while — an idempotent widening for a table that may already exist
-- with the narrower constraint, same "alter table ... add column if not
-- exists" posture the rest of this file already uses for additive changes.
alter table agent_conversations drop constraint if exists agent_conversations_channel_check;
alter table agent_conversations add constraint agent_conversations_channel_check
  check (channel in ('whatsapp', 'console'));

create unique index if not exists agent_conversations_thread_key
  on agent_conversations (shop_id, channel, external_thread_id);

create index if not exists agent_conversations_customer_id_idx
  on agent_conversations (customer_id);

alter table agent_conversations enable row level security;

grant select on agent_conversations to authenticated;

drop policy if exists "Users can view conversations for their own shops" on agent_conversations;
create policy "Users can view conversations for their own shops"
  on agent_conversations for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

-- The conversation's memory — one row per message, in order. Same write
-- posture as agent_conversations: only the webhook and the engine ever
-- write here, never the browser.
create table if not exists agent_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references agent_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  detected_language text,
  detected_intent text,
  created_at timestamptz not null default now()
);

create index if not exists agent_messages_conversation_id_idx
  on agent_messages (conversation_id, created_at);

alter table agent_messages enable row level security;

grant select on agent_messages to authenticated;

drop policy if exists "Users can view messages for their own shops' conversations" on agent_messages;
create policy "Users can view messages for their own shops' conversations"
  on agent_messages for select
  to authenticated
  using (
    conversation_id in (
      select id from agent_conversations
      where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

-- Raw RAG source material — a merchant-entered FAQ, a policy, or text
-- already extracted server-side from an uploaded PDF (extraction happens in
-- application code before the insert; this table only ever stores plain
-- text, never a binary). Written by a real merchant Server Action in their
-- own session — full CRUD, same shape as customers/promo_codes.
create table if not exists agent_documents (
  id bigint generated always as identity primary key,
  shop_id bigint not null references shops(id) on delete cascade,
  type text not null check (type in ('faq', 'policy', 'pdf', 'note')),
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_documents_shop_id_idx on agent_documents (shop_id);

-- Phase 9 (merchant Knowledge Base UI) Étape 9.0 — the one indicator of
-- indexing status this scope calls for: the timestamp of the last
-- successful indexing pass (lib/agent/rag/indexing.ts's indexDocument()),
-- stamped after a document's chunks were successfully replaced — including
-- when that document is empty and correctly produces zero chunks, which is
-- still a completed pass, not a failure. null means "never indexed".
-- Deliberately not a richer indexing_status/indexing_error/job-queue
-- system: nothing in this project's scope needs one yet, and a null vs.
-- stale timestamp already tells a merchant everything Étape 9's UI needs
-- to show — a failed attempt simply leaves this column at its previous
-- value rather than recording why, same "don't build the richer version
-- until something needs it" posture already applied throughout this
-- project (e.g. Phase 6's deferred promo code redemption tracking).
alter table agent_documents add column if not exists last_indexed_at timestamptz;

alter table agent_documents enable row level security;

grant select, insert, update, delete on agent_documents to authenticated;

drop policy if exists "Users can view documents for their own shops" on agent_documents;
create policy "Users can view documents for their own shops"
  on agent_documents for select
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can insert documents for their own shops" on agent_documents;
create policy "Users can insert documents for their own shops"
  on agent_documents for insert
  to authenticated
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can update documents for their own shops" on agent_documents;
create policy "Users can update documents for their own shops"
  on agent_documents for update
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())))
  with check (shop_id in (select id from shops where user_id = (select auth.uid())));

drop policy if exists "Users can delete documents for their own shops" on agent_documents;
create policy "Users can delete documents for their own shops"
  on agent_documents for delete
  to authenticated
  using (shop_id in (select id from shops where user_id = (select auth.uid())));

-- Available on every Supabase project regardless of plan — no new
-- infrastructure, same "no new infra" rule this project applies everywhere
-- (no Redis, no queue).
create extension if not exists vector;

-- Searchable chunks + embeddings — what RAG actually queries (Phase 6).
-- shop_id is deliberately duplicated from agent_documents here: it's a
-- query-performance column only (filters the vector search to one shop
-- without a join on the hot path), never the basis for authorization — the
-- RLS policies below still trace the real document_id -> agent_documents
-- .shop_id chain, exactly like product_variants traces product_id rather
-- than trusting a shortcut column.
--
-- vector(768) matches a Gemini text-embedding-004 embedding (free tier) —
-- the concrete provider choice belongs to Phase 3/6, not this migration;
-- switching embedding models later is an `alter column embedding type
-- vector(N)` migration, not a schema redesign.
create table if not exists agent_document_chunks (
  id bigint generated always as identity primary key,
  document_id bigint not null references agent_documents(id) on delete cascade,
  shop_id bigint not null references shops(id) on delete cascade,
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists agent_document_chunks_document_id_idx
  on agent_document_chunks (document_id);

-- hnsw over ivfflat deliberately: ivfflat's quality depends on a `lists`
-- parameter tuned to the row count at build time, which is meaningless on a
-- table starting at zero rows and would need periodic reindexing as it
-- grows. hnsw has no such parameter to get wrong and needs no maintenance
-- as the table grows — the right default for a table with no data yet.
create index if not exists agent_document_chunks_embedding_idx
  on agent_document_chunks using hnsw (embedding vector_cosine_ops);

-- Phase 8 (RAG) Étape 8.4 — the vector similarity search itself.
-- PostgREST has no fluent "order by embedding <=> query" query-builder
-- method, so this lives in an RPC function, same precedent as
-- decrement_product_stock/get_customer_stats elsewhere in this file.
-- Filters by shop_id using agent_document_chunks' own denormalized column
-- (not a join on agent_documents for that part — see this table's own
-- comment above on why), returning the k nearest neighbours by cosine
-- distance together with a normalized similarity (1 - distance) a caller
-- can apply its own relevance threshold against — this function has no
-- opinion on what counts as "relevant enough", that's
-- lib/agent/rag/retriever.ts's decision, not a decision embedded in SQL.
create or replace function match_agent_document_chunks(
  p_shop_id bigint,
  p_query_embedding vector(768),
  p_match_count integer
)
returns table (
  document_id bigint,
  document_type text,
  document_title text,
  content text,
  similarity double precision
)
language sql stable
as $$
  select
    c.document_id,
    d.type as document_type,
    d.title as document_title,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from agent_document_chunks c
  join agent_documents d on d.id = c.document_id
  where c.shop_id = p_shop_id
    and c.embedding is not null
  order by c.embedding <=> p_query_embedding
  limit p_match_count;
$$;

alter table agent_document_chunks enable row level security;

grant select, insert, update, delete on agent_document_chunks to authenticated;

drop policy if exists "Users can view chunks for their own shops' documents" on agent_document_chunks;
create policy "Users can view chunks for their own shops' documents"
  on agent_document_chunks for select
  to authenticated
  using (
    document_id in (
      select id from agent_documents
      where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can insert chunks for their own shops' documents" on agent_document_chunks;
create policy "Users can insert chunks for their own shops' documents"
  on agent_document_chunks for insert
  to authenticated
  with check (
    document_id in (
      select id from agent_documents
      where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can update chunks for their own shops' documents" on agent_document_chunks;
create policy "Users can update chunks for their own shops' documents"
  on agent_document_chunks for update
  to authenticated
  using (
    document_id in (
      select id from agent_documents
      where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  )
  with check (
    document_id in (
      select id from agent_documents
      where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

drop policy if exists "Users can delete chunks for their own shops' documents" on agent_document_chunks;
create policy "Users can delete chunks for their own shops' documents"
  on agent_document_chunks for delete
  to authenticated
  using (
    document_id in (
      select id from agent_documents
      where shop_id in (select id from shops where user_id = (select auth.uid()))
    )
  );

-- Phase 4 (Conversation Engine) — additive columns only, on the two tables
-- already created in Phase 2. See the Phase 4 architecture review for the
-- reasoning behind each one; summarized here at the point of use.

-- Structured conversation memory (summary, facts, preferences) — replaces
-- the single-purpose `summary` column considered earlier; one flexible
-- JSONB blob instead of multiple narrow columns, same idiom as
-- module_credentials.credentials. memory_version increments on every write
-- so a corrupted/hallucinated memory update is at least detectable in logs,
-- without a full history table nobody needs yet.
alter table agent_conversations add column if not exists memory jsonb not null default '{}'::jsonb;
alter table agent_conversations add column if not exists memory_version integer not null default 1;

-- Lifecycle timestamps, distinct from created_at/last_message_at — populated
-- only when the corresponding status transition actually happens.
alter table agent_conversations add column if not exists resolved_at timestamptz;
alter table agent_conversations add column if not exists escalated_at timestamptz;

-- Backs "list this shop's conversations, most recent first" (the Admin
-- Center, a later phase) with a real index instead of a full scan once the
-- table grows past a few thousand rows.
create index if not exists agent_conversations_shop_last_message_idx
  on agent_conversations (shop_id, last_message_at desc);

-- Analytical scores, queryable/filterable on their own (e.g. "conversations
-- with a negative sentiment") — kept as dedicated columns rather than
-- folded into metadata below, same treatment as detected_language/
-- detected_intent already get.
alter table agent_messages add column if not exists sentiment_score real;
alter table agent_messages add column if not exists confidence_score real;

-- Reserves the vision seam without widening ChatMessage.content's type
-- today: every message is 'text' until a future phase writes 'structured'
-- (JSON-serialized content parts) into the same `content` column. Existing
-- code, which only ever reads 'text' messages, needs no change either way.
alter table agent_messages add column if not exists content_type text not null default 'text'
  check (content_type in ('text', 'structured'));

-- Technical/observability fields likely to keep growing (provider, model,
-- latency, token usage, cost, cache, request id, ...) — one JSONB column
-- rather than a new column per field, so adding one later needs no
-- migration.
alter table agent_messages add column if not exists metadata jsonb not null default '{}'::jsonb;
