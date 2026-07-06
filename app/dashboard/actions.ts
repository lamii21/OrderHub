"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isValidOrderStatus } from "@/lib/validation";

export async function updateOrderStatus(orderId: number, status: string) {
  if (!isValidOrderStatus(status)) {
    throw new Error("Invalid status");
  }

  // Runs as the logged-in user, not the service-role client: the "update
  // orders for their own shops" RLS policy means this silently updates zero
  // rows (not an error) if the order doesn't belong to one of the caller's
  // own shops.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);

  if (error) {
    console.error("updateOrderStatus failed:", error);
    throw new Error("Could not update order status.");
  }

  revalidatePath("/dashboard");
}
