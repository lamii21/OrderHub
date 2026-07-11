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
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'shopify_store_url'
  ) then
    alter table shops rename column shopify_store_url to store_url;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'shopify_access_token'
  ) then
    alter table shops rename column shopify_access_token to api_key;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'shops' and column_name = 'shopify_last_synced_at'
  ) then
    alter table shops rename column shopify_last_synced_at to last_synced_at;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'products' and column_name = 'shopify_product_id'
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
