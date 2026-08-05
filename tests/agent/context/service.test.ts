import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getShopContext,
  getCustomerContext,
  getAgentConfig,
  getAgentCredentials,
  getConversation,
  getRecentMessages,
} = vi.hoisted(() => ({
  getShopContext: vi.fn(),
  getCustomerContext: vi.fn(),
  getAgentConfig: vi.fn(),
  getAgentCredentials: vi.fn(),
  getConversation: vi.fn(),
  getRecentMessages: vi.fn(),
}));

vi.mock("@/lib/agent/context/repository", () => ({
  getShopContext,
  getCustomerContext,
  getAgentConfig,
  getAgentCredentials,
}));
vi.mock("@/lib/agent/conversation/service", () => ({ getConversation, getRecentMessages }));

import { assembleExecutionContext } from "@/lib/agent/context/service";
import type { AgentConversation, AgentMessage } from "@/lib/agent/types";

const conversationWithCustomer: AgentConversation = {
  id: 1,
  shop_id: 15,
  customer_id: 42,
  channel: "whatsapp",
  external_thread_id: "212600000000",
  status: "open",
  memory: { version: 1 },
  created_at: "2026-08-05T10:00:00.000Z",
  last_message_at: "2026-08-05T10:00:00.000Z",
  resolved_at: null,
  escalated_at: null,
};

const shop = { id: 15, name: "AYLA", currency: "USD", timezone: "UTC" };
const customer = { id: 42, name: "lamiae", phone: "212600000000", email: null };
const agentConfig = {
  shop_id: 15,
  is_active: true,
  system_prompt: null,
  tone: "friendly",
  languages: ["fr", "en", "ar-ma"],
  ai_provider: "openrouter",
  ai_model: "test-model",
  enabled_tools: [],
};
const credentials = { apiKey: "sk-or-test", model: "test-model" };
const messages: AgentMessage[] = [];

beforeEach(() => {
  getShopContext.mockReset();
  getCustomerContext.mockReset();
  getAgentConfig.mockReset();
  getAgentCredentials.mockReset();
  getConversation.mockReset();
  getRecentMessages.mockReset();
});

describe("assembleExecutionContext", () => {
  it("assembles a complete context when the conversation has a known customer", async () => {
    getConversation.mockResolvedValue(conversationWithCustomer);
    getShopContext.mockResolvedValue(shop);
    getCustomerContext.mockResolvedValue(customer);
    getAgentConfig.mockResolvedValue(agentConfig);
    getAgentCredentials.mockResolvedValue(credentials);
    getRecentMessages.mockResolvedValue(messages);

    const result = await assembleExecutionContext(1);

    expect(result).toEqual({
      conversation_context: {
        shop,
        customer,
        conversation: conversationWithCustomer,
        recent_messages: messages,
      },
      agent_config: agentConfig,
      credentials,
      options: {},
    });
    expect(getCustomerContext).toHaveBeenCalledWith(42);
  });

  it("resolves customer to null without calling getCustomerContext when the conversation has no customer_id", async () => {
    getConversation.mockResolvedValue({ ...conversationWithCustomer, customer_id: null });
    getShopContext.mockResolvedValue(shop);
    getAgentConfig.mockResolvedValue(agentConfig);
    getAgentCredentials.mockResolvedValue(credentials);
    getRecentMessages.mockResolvedValue(messages);

    const result = await assembleExecutionContext(1);

    expect(result.conversation_context.customer).toBeNull();
    expect(getCustomerContext).not.toHaveBeenCalled();
  });

  it("passes options.max_recent_messages through to getRecentMessages, defaulting to 20 when omitted", async () => {
    getConversation.mockResolvedValue(conversationWithCustomer);
    getShopContext.mockResolvedValue(shop);
    getCustomerContext.mockResolvedValue(customer);
    getAgentConfig.mockResolvedValue(agentConfig);
    getAgentCredentials.mockResolvedValue(credentials);
    getRecentMessages.mockResolvedValue(messages);

    await assembleExecutionContext(1, { max_recent_messages: 5 });
    expect(getRecentMessages).toHaveBeenCalledWith(1, 5);

    await assembleExecutionContext(1);
    expect(getRecentMessages).toHaveBeenCalledWith(1, 20);
  });

  it("returns the given options unchanged as part of the execution context", async () => {
    getConversation.mockResolvedValue(conversationWithCustomer);
    getShopContext.mockResolvedValue(shop);
    getCustomerContext.mockResolvedValue(customer);
    getAgentConfig.mockResolvedValue(agentConfig);
    getAgentCredentials.mockResolvedValue(credentials);
    getRecentMessages.mockResolvedValue(messages);

    const result = await assembleExecutionContext(1, { temperature: 0.5 });

    expect(result.options).toEqual({ temperature: 0.5 });
  });

  it("throws when the conversation does not exist, without querying anything else", async () => {
    getConversation.mockResolvedValue(null);

    await expect(assembleExecutionContext(999)).rejects.toThrow("conversation 999 does not exist");
    expect(getShopContext).not.toHaveBeenCalled();
    expect(getAgentConfig).not.toHaveBeenCalled();
    expect(getAgentCredentials).not.toHaveBeenCalled();
  });

  it("throws when the shop no longer exists", async () => {
    getConversation.mockResolvedValue(conversationWithCustomer);
    getShopContext.mockResolvedValue(null);
    getCustomerContext.mockResolvedValue(customer);
    getAgentConfig.mockResolvedValue(agentConfig);
    getAgentCredentials.mockResolvedValue(credentials);
    getRecentMessages.mockResolvedValue(messages);

    await expect(assembleExecutionContext(1)).rejects.toThrow("shop 15 does not exist");
  });

  it("throws a clear error when no AI agent is configured for the shop", async () => {
    getConversation.mockResolvedValue(conversationWithCustomer);
    getShopContext.mockResolvedValue(shop);
    getCustomerContext.mockResolvedValue(customer);
    getAgentConfig.mockResolvedValue(null);
    getAgentCredentials.mockResolvedValue(credentials);
    getRecentMessages.mockResolvedValue(messages);

    await expect(assembleExecutionContext(1)).rejects.toThrow("no AI agent configured for shop 15");
  });

  it("throws a clear, distinct error when the agent is configured but has no provider credentials", async () => {
    getConversation.mockResolvedValue(conversationWithCustomer);
    getShopContext.mockResolvedValue(shop);
    getCustomerContext.mockResolvedValue(customer);
    getAgentConfig.mockResolvedValue(agentConfig);
    getAgentCredentials.mockResolvedValue(null);
    getRecentMessages.mockResolvedValue(messages);

    await expect(assembleExecutionContext(1)).rejects.toThrow(
      "no AI provider credentials configured for shop 15 (module_name: ai-sales-agent)"
    );
  });
});
