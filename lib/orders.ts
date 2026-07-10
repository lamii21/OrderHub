import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "@/types/order";

export type StatusChangeOutcome =
  | { outcome: "unchanged" }
  | { outcome: "updated"; previousStatus: string; order: Order }
  | { outcome: "error" };

// The one place "change an order's status" actually writes orders +
// order_history — shared by the dashboard's updateOrderStatus() Server
// Action and the Update Status automation module, so neither duplicates it
// (the Automation Modules catalog calls this out explicitly for that
// module). Takes the caller's Supabase client instead of importing one:
// the Server Action passes its RLS-scoped client (so "only your own
// orders" keeps being enforced by RLS, not by a check written here); the
// module passes the service-role client, since it runs in the Execution
// Engine's system context with no user session, same as every other module.
//
// Deliberately does not dispatch order.status_changed/order.cancelled
// itself — callers decide that. The Update Status module intentionally
// never dispatches: doing so with no cascade-depth guard in the Execution
// Engine could re-trigger the same workflow indefinitely (flagged
// explicitly in the Automation Modules catalog as a real risk, not yet
// mitigated). Only the user-facing updateOrderStatus() dispatches today.
export async function applyOrderStatusChange(
  supabase: SupabaseClient,
  orderId: number,
  newStatus: string,
  changedBy: string | null
): Promise<StatusChangeOutcome> {
  const { data: existingOrder, error: fetchError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (fetchError || !existingOrder) {
    console.error("applyOrderStatusChange: failed to load current status:", fetchError);
    return { outcome: "error" };
  }

  const previousStatus = existingOrder.status as string;

  // Nothing actually changed — no update, no history entry. Also what
  // stops a duplicate entry if the same status gets submitted twice.
  if (previousStatus === newStatus) {
    return { outcome: "unchanged" };
  }

  const { data: updatedOrder, error } = await supabase
    .from("orders")
    .update({ status: newStatus })
    .eq("id", orderId)
    .select("*, shops(name, platform)")
    .single();

  if (error || !updatedOrder) {
    console.error("applyOrderStatusChange failed:", error);
    return { outcome: "error" };
  }

  // Best-effort: the status change itself already succeeded, so a failure
  // here logs but doesn't roll back or fail the caller, same pattern as
  // recordSyncHistory().
  const { error: historyError } = await supabase.from("order_history").insert({
    order_id: orderId,
    previous_status: previousStatus,
    new_status: newStatus,
    changed_by: changedBy,
  });

  if (historyError) {
    console.error("applyOrderStatusChange: failed to record order history:", historyError);
  }

  return { outcome: "updated", previousStatus, order: updatedOrder as Order };
}
