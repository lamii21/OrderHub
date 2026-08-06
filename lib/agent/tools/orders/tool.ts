import { getOrderStatusForCustomer } from "./service";
import type { ToolDefinition, ToolExecutionContext } from "../types";

// The one file in this folder that knows about ToolDefinition — repository.ts
// and service.ts have no import from lib/agent/ at all, so this is the only
// place "order status lookup" and "the AI engine" ever meet. Its whole job
// is translating between the two: untrusted, loosely-typed model arguments
// in, a small customer-safe JSON-serializable result out.
export const getOrderStatusTool: ToolDefinition = {
  name: "get_order_status",
  description:
    "Look up the status of the customer's own order — their most recent one if no order number " +
    "is given, or a specific one identified by its order number.",
  parameters: {
    type: "object",
    properties: {
      order_id: {
        type: "string",
        description: "The customer's order number, if they provided one. Omit to look up their most recent order.",
      },
    },
  },
  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    // context.customer_id, never args.customer_id — see ToolExecutionContext's
    // own comment on why a model-supplied customer id is untrusted input.
    // A conversation with no identified customer yet must never fall back
    // to an unscoped, shop-wide query.
    if (context.customer_id === null) {
      return { found: false, reason: "no_customer_identified" };
    }

    const orderId = typeof args.order_id === "string" ? args.order_id : undefined;
    const result = await getOrderStatusForCustomer(context.shop_id, context.customer_id, orderId);

    if (!result.found) {
      return { found: false, reason: "not_found" };
    }

    return { found: true, order: result.order };
  },
};
