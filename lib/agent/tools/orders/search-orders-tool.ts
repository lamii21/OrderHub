import { searchOrdersForCustomer } from "./service";
import type { ToolDefinition, ToolExecutionContext } from "../types";
import { ORDER_STATUSES, isValidOrderStatus } from "@/lib/validation";

// A separate file from tool.ts (one file per tool, same convention as
// tools/products vs tools/promo-codes each having their own tool.ts) even
// though both live under tools/orders — get_order_status and search_orders
// share a repository/service but are two independent ToolDefinitions the
// registry advertises separately.
export const searchOrdersTool: ToolDefinition = {
  name: "search_orders",
  description:
    "Search the customer's own orders, optionally filtered by status or by a product name match. " +
    "Returns up to 5 most recent matches, newest first.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ORDER_STATUSES,
        description: "Filter by order status.",
      },
      product: {
        type: "string",
        description: "Filter by a product name or partial match.",
      },
    },
  },
  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    // context.customer_id, never args — same rule as every other tool in
    // this folder.
    if (context.customer_id === null) {
      return { orders: [], reason: "no_customer_identified" };
    }

    // An invalid/malformed status is silently dropped rather than treated
    // as an error — same "tolerant of a confused model" posture
    // search_products already takes for a non-string query, rather than
    // failing the whole call over one bad argument the tool can just ignore.
    const status = typeof args.status === "string" && isValidOrderStatus(args.status) ? args.status : undefined;
    const product = typeof args.product === "string" && args.product.trim() !== "" ? args.product.trim() : undefined;

    return searchOrdersForCustomer(context.shop_id, context.customer_id, { status, product });
  },
};
