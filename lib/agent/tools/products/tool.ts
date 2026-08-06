import { searchProductsForCustomer } from "./service";
import type { ToolDefinition, ToolExecutionContext } from "../types";

// The one file in this folder that knows about ToolDefinition — same split
// as tools/orders. No customer_id involved anywhere here: product search is
// shop-wide, not scoped to whoever is asking, unlike get_order_status.
export const searchProductsTool: ToolDefinition = {
  name: "search_products",
  description:
    "Search the shop's product catalog by name. Returns up to a handful of matching products, " +
    "each with its available variants (size, color, ...) and a stock availability indicator.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text to search for in product names (e.g. a product name, category, or keyword).",
      },
    },
    required: ["query"],
  },
  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const query = typeof args.query === "string" ? args.query.trim() : "";

    // An empty pattern would match every product in the shop via ILIKE's
    // own "%%" wildcard — guarded here rather than trusting the model to
    // never call this tool with nothing to search for.
    if (query === "") {
      return { products: [], reason: "empty_query" };
    }

    const products = await searchProductsForCustomer(context.shop_id, query);
    return { products };
  },
};
