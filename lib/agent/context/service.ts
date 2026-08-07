import { getShopContext, getCustomerContext, getAgentConfig, getAgentCredentials } from "./repository";
import { getConversation, getRecentMessages } from "../conversation/service";
import type { AgentEngineOptions, AgentExecutionContext } from "../engine/types";

// The one place that knows a complete AgentExecutionContext requires
// reading four different tables (shops, customers, ai_agents,
// module_credentials) plus the conversation subsystem's own two — the
// engine (a later step) only ever calls assembleExecutionContext(), never
// any of these sources individually, so it never needs to know they're
// separate at all.

const DEFAULT_MAX_RECENT_MESSAGES = 20;

export async function assembleExecutionContext(
  conversationId: number,
  options: AgentEngineOptions = {}
): Promise<AgentExecutionContext> {
  const conversation = await getConversation(conversationId);

  if (!conversation) {
    throw new Error(`Cannot assemble context: conversation ${conversationId} does not exist.`);
  }

  // Five independent reads — none depends on another's result — run in
  // parallel rather than five sequential round trips.
  const [shop, customer, agentConfig, credentials, recentMessages] = await Promise.all([
    getShopContext(conversation.shop_id),
    conversation.customer_id ? getCustomerContext(conversation.customer_id) : Promise.resolve(null),
    getAgentConfig(conversation.shop_id),
    getAgentCredentials(conversation.shop_id),
    getRecentMessages(conversationId, options.max_recent_messages ?? DEFAULT_MAX_RECENT_MESSAGES),
  ]);

  if (!shop) {
    throw new Error(`Cannot assemble context: shop ${conversation.shop_id} does not exist.`);
  }

  if (!agentConfig) {
    throw new Error(`Cannot assemble context: no AI agent configured for shop ${conversation.shop_id}.`);
  }

  if (!credentials) {
    throw new Error(
      `Cannot assemble context: no AI provider credentials configured for shop ${conversation.shop_id} (module_name: ai-sales-agent).`
    );
  }

  return {
    conversation_context: {
      shop,
      customer,
      conversation,
      recent_messages: recentMessages,
    },
    agent_config: agentConfig,
    credentials,
    options,
    // Populated for real by the engine's retrieval step (Phase 8 Étape
    // 8.5) — assembleExecutionContext() itself has no reason to know
    // anything about RAG, so this starts empty rather than undefined,
    // keeping AgentExecutionContext a complete value from the moment it's
    // constructed.
    retrieved_context: [],
  };
}
