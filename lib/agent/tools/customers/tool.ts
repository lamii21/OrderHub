import { getCustomerStatsForCustomer } from "./service";
import type { ToolDefinition, ToolExecutionContext } from "../types";

// The one file in this folder that knows about ToolDefinition — same split
// as tools/orders, tools/products, tools/promo-codes. No arguments at all:
// this always means "the customer I'm currently talking to", the same
// posture get_order_status takes when order_id is omitted — there is no
// legitimate reason for the model to ever ask about a different customer_id
// than the one already resolved for this conversation.
export const getCustomerTool: ToolDefinition = {
  name: "get_customer",
  description:
    "Look up an order history summary (number of orders, total spent, most recent order date) for the " +
    "customer you're currently talking to.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    // context.customer_id, never anything from args — this tool takes no
    // arguments at all precisely so there is nothing for a model-supplied
    // customer id to hide in.
    if (context.customer_id === null) {
      return { found: false, reason: "no_customer_identified" };
    }

    const result = await getCustomerStatsForCustomer(context.shop_id, context.customer_id);

    if (!result.found) {
      return { found: false, reason: "not_found" };
    }

    return { found: true, stats: result.stats };
  },
};
