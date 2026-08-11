import { supabase } from "@/lib/supabase";

// Pure Supabase I/O — no decisions here, same rule as every other
// repository.ts in this folder.

export type CustomerStats = {
  order_count: number;
  ltv: number;
  last_order_at: string | null;
};

// get_customer_stats(p_customer_id) (supabase/schema.sql) is a plain SQL
// function with no shop_id parameter of its own — it trusts whatever
// customer_id it's given and aggregates that customer's orders regardless
// of shop. Since this repository runs under the service-role client (no
// RLS), the ownership check below is NOT optional: it's the only thing
// standing between "this customer_id" and "any customer_id in the whole
// database" before the RPC ever runs. Mirrors the same defense
// tools/orders/repository.ts already applies via its own double .eq()
// scoping, just structured as an explicit pre-check since the RPC itself
// can't be scoped the same way.
export async function getCustomerStats(shopId: number, customerId: number): Promise<CustomerStats | null> {
  const { data: owned, error: ownershipError } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (ownershipError) {
    throw new Error(ownershipError.message);
  }

  if (!owned) {
    return null;
  }

  const { data, error } = await supabase.rpc("get_customer_stats", { p_customer_id: customerId });

  if (error) {
    throw new Error(error.message);
  }

  return (data?.[0] as CustomerStats | undefined) ?? null;
}
