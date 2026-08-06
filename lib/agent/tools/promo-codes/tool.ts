import { checkPromoCodeValidity } from "./service";
import type { ToolDefinition, ToolExecutionContext } from "../types";

// The one file in this folder that knows about ToolDefinition — same split
// as tools/orders and tools/products. No customer_id involved: a promo
// code's validity isn't scoped to whoever is asking, only to the shop.
export const checkPromoCodeTool: ToolDefinition = {
  name: "check_promo_code",
  description:
    "Check whether a promo code is valid for this shop and not expired. This cannot determine whether the " +
    "code has already been redeemed by someone else — say so if the customer asks.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The promo code to check, exactly as given by the customer.",
      },
    },
    required: ["code"],
  },
  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const code = typeof args.code === "string" ? args.code.trim() : "";

    if (code === "") {
      return { valid: false, reason: "empty_code" };
    }

    return checkPromoCodeValidity(context.shop_id, code);
  },
};
