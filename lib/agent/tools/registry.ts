import type { ChatTool } from "@/lib/ai";
import { getOrderStatusTool } from "./orders/tool";
import { searchProductsTool } from "./products/tool";
import { checkPromoCodeTool } from "./promo-codes/tool";
import type { ToolDefinition } from "./types";

// Same registry-of-named-modules shape as lib/ai/index.ts's chatProviders/
// embeddingProviders and lib/platforms/index.ts's connector registry.
// get_order_status (Étape 6.1), search_products (Étape 6.2), and
// check_promo_code (Étape 6.3) are exactly the pure additions the Phase 5
// Étape 8 comment on this file anticipated: nothing in dispatch.ts or the
// engine's provider loop needed to change to add any of them.
const tools: Record<string, ToolDefinition> = {
  get_order_status: getOrderStatusTool,
  search_products: searchProductsTool,
  check_promo_code: checkPromoCodeTool,
};

export function getTool(name: string): ToolDefinition | null {
  return tools[name] ?? null;
}

// Resolves a shop's configured tool names (AiAgentConfig.enabled_tools)
// down to the ChatTool[] the provider loop advertises to the model —
// silently drops a name that isn't (or is no longer) registered, since a
// stale or misspelled entry in a shop's config is a data quality issue, not
// a reason to break that shop's whole conversation.
export function getEnabledTools(names: string[]): ChatTool[] {
  return names
    .map((name) => tools[name])
    .filter((tool): tool is ToolDefinition => tool !== undefined)
    .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}
