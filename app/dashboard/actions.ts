"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isValidOrderStatus } from "@/lib/validation";
import { applyOrderStatusChange } from "@/lib/orders";
import { handleEvent } from "@/lib/workflows/dispatch";
import type { EventType } from "@/lib/events/types";

export async function updateOrderStatus(orderId: number, status: string) {
  if (!isValidOrderStatus(status)) {
    throw new Error("Invalid status");
  }

  // Runs as the logged-in user, not the service-role client: the "update
  // orders for their own shops" RLS policy means this silently updates zero
  // rows (not an error) if the order doesn't belong to one of the caller's
  // own shops.
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await applyOrderStatusChange(supabase, orderId, status, user?.id ?? null);

  if (result.outcome === "error") {
    throw new Error("Could not update order status.");
  }

  if (result.outcome === "unchanged") {
    return;
  }

  // Fires after the status change (and its history row) are already
  // committed — automation is a downstream effect of the status change,
  // never a precondition for it. order.cancelled fires alongside the
  // generic order.status_changed (not instead of it), so a merchant can
  // build a workflow against either one — the Triggers layer runs every
  // matching workflow independently, by design.
  const eventsToDispatch: EventType[] = ["order.status_changed"];
  if (status === "cancelled") {
    eventsToDispatch.push("order.cancelled");
  }

  if (result.order.shop_id !== null) {
    for (const eventType of eventsToDispatch) {
      try {
        await handleEvent(result.order.shop_id, eventType, result.order);
      } catch (err) {
        console.error(`updateOrderStatus: ${eventType} dispatch failed:`, err);
      }
    }
  }

  revalidatePath("/dashboard");
  revalidatePath(`/orders/${orderId}`);
}
