import { supabase } from "@/lib/supabase";
import { isValidOrderStatus, ORDER_STATUSES } from "@/lib/validation";
import { applyOrderStatusChange } from "@/lib/orders";
import type { AutomationModule } from "./types";

type UpdateStatusConfig = { status: string };

// Reuses applyOrderStatusChange() — the exact same write path as the
// dashboard's updateOrderStatus() Server Action — so this module can never
// drift from how a human-driven status change behaves (same order_history
// row, same shape). Uses the service-role client (this runs inside the
// Execution Engine's system context, not a user session), and changed_by
// is null: nobody "did" this, the workflow did.
//
// Deliberately does NOT dispatch order.status_changed/order.cancelled the
// way the Server Action does — the Automation Modules catalog calls this
// out explicitly: a workflow triggered by order.status_changed that
// includes an Update Status step would immediately re-trigger itself (or
// another workflow). dispatch.ts's handleEvent() now has a depth guard
// (MAX_DISPATCH_DEPTH) that would stop such a cycle from recursing forever,
// but that's defense-in-depth for if this ever changes, not a green light
// on its own — a module "never knowing about the Execution Engine" still
// means it has no business re-entering it. Re-dispatching from this module
// remains intentionally out of scope.
export const updateStatusModule: AutomationModule = {
  validateConfig(config) {
    const { status } = config as Partial<UpdateStatusConfig>;

    if (!isValidOrderStatus(status)) {
      return `Update Status requires a status among: ${ORDER_STATUSES.join(", ")}.`;
    }

    return null;
  },

  async run(order, config) {
    const { status } = config as UpdateStatusConfig;

    if (!isValidOrderStatus(status)) {
      return { success: false, message: `Invalid target status "${status}".` };
    }

    const result = await applyOrderStatusChange(supabase, order.id, status, null);

    if (result.outcome === "error") {
      return { success: false, message: "Could not update the order status." };
    }

    if (result.outcome === "unchanged") {
      return { success: true, message: `Order already has status "${status}".` };
    }

    return {
      success: true,
      message: `Status changed from "${result.previousStatus}" to "${status}".`,
      data: { previousStatus: result.previousStatus, newStatus: status },
    };
  },
};
