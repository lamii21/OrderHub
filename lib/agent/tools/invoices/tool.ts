import { getInvoiceForCustomer } from "./service";
import type { ToolDefinition, ToolExecutionContext } from "../types";

// The one file in this folder that knows about ToolDefinition — same split
// as every other tools/*/tool.ts. Mirrors get_order_status's shape exactly
// (optional order_id, most recent when omitted) since it answers the same
// kind of question about the same customer-owned resource.
export const getInvoiceTool: ToolDefinition = {
  name: "get_invoice",
  description:
    "Look up the invoice for one of the customer's own orders — their most recent invoice if no order " +
    "number is given, or a specific one identified by its order number. Not every order has an invoice.",
  parameters: {
    type: "object",
    properties: {
      order_id: {
        type: "string",
        description: "The customer's order number, if they provided one. Omit to look up their most recent invoice.",
      },
    },
  },
  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    // context.customer_id, never args.customer_id — same rule as every
    // other tool in this project.
    if (context.customer_id === null) {
      return { found: false, reason: "no_customer_identified" };
    }

    const orderId = typeof args.order_id === "string" ? args.order_id : undefined;
    const result = await getInvoiceForCustomer(context.shop_id, context.customer_id, orderId);

    if (!result.found) {
      return { found: false, reason: "not_found" };
    }

    return { found: true, invoice: result.invoice };
  },
};
