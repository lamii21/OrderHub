import { supabase } from "@/lib/supabase";

export type CustomerInput = {
  shopId: number;
  phone: string;
  name?: string | null;
  city?: string | null;
  address?: string | null;
  email?: string | null;
};

// The one place a customer identity is resolved or created — mirrors
// lib/shop.ts's createOrUpdateShop() in spirit, but simpler: phone is
// `not null` at the schema level and has always been (see the customers
// table comment in supabase/schema.sql), so a plain upsert on the real
// (shop_id, phone) unique constraint is sufficient here — none of the
// NULL-collision workaround createOrUpdateShop() needs for sheet_id
// applies, because there is no equivalent history of phone ever being
// optional in this table.
//
// Callers must never invoke this with an empty phone — there is nothing
// to key the upsert on. The webhook (app/api/orders/route.ts) enforces
// that by only calling this when body.customer_phone is a non-empty
// string, same "skip, don't fail the order" posture as product matching.
export async function createOrUpdateCustomer(input: CustomerInput) {
  const phone = input.phone.trim();

  const { data, error } = await supabase
    .from("customers")
    .upsert(
      {
        shop_id: input.shopId,
        phone,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.email !== undefined && { email: input.email }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,phone" }
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
