import { supabase } from "@/lib/supabase";
import type { OrderStatus } from "@/lib/validation";

// Pure Supabase I/O — no decisions here, same rule as
// lib/agent/context/repository.ts. Every query below is scoped by BOTH
// shop_id and customer_id: this is system-context code (the service-role
// client, no RLS), so there is no other enforcement of "only this
// customer's own orders" — a missing customer_id filter here would be a
// real cross-customer data leak, not just a style issue.
//
// Column list deliberately excludes customer_name/customer_phone/
// customer_city/customer_address/customer_email, id, and product_id — a
// customer-facing tool has no reason to round-trip its own contact details
// through an LLM prompt just to answer "where's my order", and id/product_id
// are internal identifiers (Supabase's own primary key, and a join key) the
// customer never sees — order_id (the human-facing order number) is the
// only identifier this tool ever exposes. Same convention formalized by
// tools/products (Étape 6.2): never a raw Supabase id, never an internal
// join key.
const ORDER_COLUMNS = "order_id, product, quantity, price, status, created_at";

export type OrderForCustomer = {
  order_id: string | null;
  product: string | null;
  quantity: number | null;
  price: number | null;
  status: OrderStatus;
  created_at: string;
};

export async function findOrderByOrderId(
  shopId: number,
  customerId: number,
  orderId: string
): Promise<OrderForCustomer | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("shop_id", shopId)
    .eq("customer_id", customerId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function findMostRecentOrderForCustomer(
  shopId: number,
  customerId: number
): Promise<OrderForCustomer | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("shop_id", shopId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
