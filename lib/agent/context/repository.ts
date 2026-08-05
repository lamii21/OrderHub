import { supabase } from "@/lib/supabase";
import { getModuleCredentials } from "@/lib/automation-modules/credentials";
import type { AiCredentials } from "@/lib/ai";
import type { AiAgentConfig, ConversationCustomerContext, ConversationShopContext } from "../types";

// Distinct from "ai-agent" (lib/automation-modules/ai-agent.ts's existing
// single-turn classification module) — see the Phase 3 credentials
// decision this reuses. Reusing the exact getModuleCredentials() already
// used by every other automation module (WhatsApp, Email, ...), not a
// second copy of its lookup/caching logic.
const AI_AGENT_MODULE_NAME = "ai-sales-agent";

// Pure Supabase I/O for the three sources context assembly (service.ts)
// needs beyond conversation/repository.ts's own tables — shops, customers,
// and ai_agents, none of which any part of lib/agent/ has read before this
// step. Same rule as conversation/repository.ts: no decisions here, only
// translations of one query each.

export async function getShopContext(shopId: number): Promise<ConversationShopContext | null> {
  const { data, error } = await supabase
    .from("shops")
    .select("id, name, currency, timezone")
    .eq("id", shopId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getCustomerContext(customerId: number): Promise<ConversationCustomerContext | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .eq("id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getAgentConfig(shopId: number): Promise<AiAgentConfig | null> {
  const { data, error } = await supabase
    .from("ai_agents")
    .select("shop_id, is_active, system_prompt, tone, languages, ai_provider, ai_model, enabled_tools")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// Not pure Supabase access on its own (getModuleCredentials does its own
// caching), but it lives here rather than in the engine so "the engine
// never touches Supabase" holds even indirectly — every path to
// module_credentials for this subsystem goes through this one function.
// Returns null both when nothing is configured and when what's stored
// doesn't have the two fields a credential must have, rather than handing
// a caller a malformed AiCredentials to fail on later.
export async function getAgentCredentials(shopId: number): Promise<AiCredentials | null> {
  const credentials = await getModuleCredentials(shopId, AI_AGENT_MODULE_NAME);

  if (!credentials || typeof credentials.apiKey !== "string" || typeof credentials.model !== "string") {
    return null;
  }

  return { apiKey: credentials.apiKey, model: credentials.model };
}
