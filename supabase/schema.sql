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
