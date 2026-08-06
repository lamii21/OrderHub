import { describe, it, expect, vi, beforeEach } from "vitest";

const { getChatProvider, chat, getEnabledTools, dispatchToolCall } = vi.hoisted(() => ({
  getChatProvider: vi.fn(),
  chat: vi.fn(),
  getEnabledTools: vi.fn(),
  dispatchToolCall: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ getChatProvider }));
vi.mock("@/lib/agent/tools/registry", () => ({ getEnabledTools }));
vi.mock("@/lib/agent/tools/dispatch", () => ({ dispatchToolCall }));

import { runProviderLoop, MAX_TOOL_ROUNDTRIPS } from "@/lib/agent/engine/provider-loop";
import type { AgentExecutionContext } from "@/lib/agent/engine/types";

const context: AgentExecutionContext = {
  conversation_context: {
    shop: { id: 15, name: "AYLA", currency: "USD", timezone: "UTC" },
    customer: null,
    conversation: {
      id: 1,
      shop_id: 15,
      customer_id: null,
      channel: "whatsapp",
      external_thread_id: "212600000000",
      status: "open",
      memory: { version: 1 },
      created_at: "2026-08-06T10:00:00.000Z",
      last_message_at: "2026-08-06T10:00:00.000Z",
      resolved_at: null,
      escalated_at: null,
    },
    recent_messages: [],
  },
  agent_config: {
    shop_id: 15,
    is_active: true,
    system_prompt: null,
    tone: "friendly",
    languages: ["fr"],
    ai_provider: "openrouter",
    ai_model: "test-model",
    enabled_tools: [],
  },
  credentials: { apiKey: "sk-or-test", model: "test-model" },
  options: {},
};

const initialMessages = [{ role: "system" as const, content: "system prompt" }];

const finalResult = {
  content: "Wah, kayn 3 modèles.",
  provider: "openrouter",
  model: "test-model",
  finishReason: "stop" as const,
};

beforeEach(() => {
  getChatProvider.mockReset().mockReturnValue({ name: "openrouter", chat });
  chat.mockReset().mockResolvedValue(finalResult);
  getEnabledTools.mockReset().mockReturnValue([]);
  dispatchToolCall.mockReset();
});

describe("runProviderLoop — no tool calls", () => {
  it("resolves on the first call when the provider doesn't ask for a tool", async () => {
    const { result, toolCalls } = await runProviderLoop(context, initialMessages);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(context.credentials, initialMessages, {});
    expect(result).toEqual(finalResult);
    expect(toolCalls).toEqual([]);
  });

  it("passes temperature through to the provider only when explicitly given", async () => {
    await runProviderLoop({ ...context, options: { temperature: 0.7 } }, initialMessages);
    expect(chat).toHaveBeenCalledWith(context.credentials, initialMessages, { temperature: 0.7 });
  });

  it("omits tools from chatOptions when no tools are enabled", async () => {
    await runProviderLoop(context, initialMessages);
    expect(chat.mock.calls[0][2]).not.toHaveProperty("tools");
  });

  it("advertises the shop's enabled tools when there are any", async () => {
    const tools = [{ name: "check_stock", description: "Check product stock", parameters: { type: "object" } }];
    getEnabledTools.mockReturnValue(tools);

    await runProviderLoop(context, initialMessages);

    expect(getEnabledTools).toHaveBeenCalledWith(context.agent_config.enabled_tools);
    expect(chat.mock.calls[0][2]).toMatchObject({ tools });
  });

  it("propagates an unknown provider name error from getChatProvider", async () => {
    getChatProvider.mockImplementation(() => {
      throw new Error('No chat provider registered for "made-up"');
    });

    await expect(runProviderLoop(context, initialMessages)).rejects.toThrow(
      'No chat provider registered for "made-up"'
    );
  });

  it("propagates a provider chat() failure as-is", async () => {
    chat.mockRejectedValue(new Error("rate limit exceeded"));
    await expect(runProviderLoop(context, initialMessages)).rejects.toThrow("rate limit exceeded");
  });
});

describe("runProviderLoop — with tool calls", () => {
  const toolCall = { id: "call_1", name: "check_stock", arguments: { productId: 42 } };

  it("dispatches a requested tool call, replays the exchange, and calls the provider again", async () => {
    chat
      .mockResolvedValueOnce({
        content: null,
        provider: "openrouter",
        model: "test-model",
        finishReason: "tool_calls",
        toolCalls: [toolCall],
      })
      .mockResolvedValueOnce(finalResult);
    dispatchToolCall.mockResolvedValue({
      id: "call_1",
      name: "check_stock",
      arguments: { productId: 42 },
      status: "succeeded",
      result: { inStock: 12 },
    });

    const { result, toolCalls } = await runProviderLoop(context, initialMessages);

    expect(dispatchToolCall).toHaveBeenCalledWith(toolCall, { shop_id: 15, conversation_id: 1, customer_id: null });
    expect(chat).toHaveBeenCalledTimes(2);

    const secondCallMessages = chat.mock.calls[1][1];
    expect(secondCallMessages).toEqual([
      ...initialMessages,
      { role: "assistant", content: "", toolCalls: [toolCall] },
      { role: "tool", content: JSON.stringify({ inStock: 12 }), toolCallId: "call_1" },
    ]);

    expect(result).toEqual(finalResult);
    expect(toolCalls).toEqual([
      { id: "call_1", name: "check_stock", arguments: { productId: 42 }, status: "succeeded", result: { inStock: 12 } },
    ]);
  });

  it("resolves customer_id from the conversation itself, not from any argument the model supplies", async () => {
    const contextWithCustomer: AgentExecutionContext = {
      ...context,
      conversation_context: {
        ...context.conversation_context,
        conversation: { ...context.conversation_context.conversation, customer_id: 42 },
      },
    };
    chat
      .mockResolvedValueOnce({
        content: null,
        provider: "openrouter",
        model: "test-model",
        finishReason: "tool_calls",
        toolCalls: [toolCall],
      })
      .mockResolvedValueOnce(finalResult);
    dispatchToolCall.mockResolvedValue({
      id: "call_1",
      name: "check_stock",
      arguments: { productId: 42 },
      status: "succeeded",
      result: { inStock: 12 },
    });

    await runProviderLoop(contextWithCustomer, initialMessages);

    expect(dispatchToolCall).toHaveBeenCalledWith(toolCall, { shop_id: 15, conversation_id: 1, customer_id: 42 });
  });

  it("feeds a failed dispatch back to the model as a tool result instead of throwing", async () => {
    chat
      .mockResolvedValueOnce({
        content: null,
        provider: "openrouter",
        model: "test-model",
        finishReason: "tool_calls",
        toolCalls: [toolCall],
      })
      .mockResolvedValueOnce(finalResult);
    dispatchToolCall.mockResolvedValue({
      id: "call_1",
      name: "check_stock",
      arguments: { productId: 42 },
      status: "failed",
      error: "Unknown tool.",
    });

    await runProviderLoop(context, initialMessages);

    const secondCallMessages = chat.mock.calls[1][1];
    expect(secondCallMessages[2]).toEqual({
      role: "tool",
      content: JSON.stringify({ error: "Unknown tool." }),
      toolCallId: "call_1",
    });
  });

  it("accumulates tool calls across multiple round-trips", async () => {
    const secondToolCall = { id: "call_2", name: "check_stock", arguments: { productId: 7 } };
    chat
      .mockResolvedValueOnce({
        content: null,
        provider: "openrouter",
        model: "test-model",
        finishReason: "tool_calls",
        toolCalls: [toolCall],
      })
      .mockResolvedValueOnce({
        content: null,
        provider: "openrouter",
        model: "test-model",
        finishReason: "tool_calls",
        toolCalls: [secondToolCall],
      })
      .mockResolvedValueOnce(finalResult);
    dispatchToolCall
      .mockResolvedValueOnce({ id: "call_1", name: "check_stock", arguments: { productId: 42 }, status: "succeeded", result: 12 })
      .mockResolvedValueOnce({ id: "call_2", name: "check_stock", arguments: { productId: 7 }, status: "succeeded", result: 3 });

    const { toolCalls } = await runProviderLoop(context, initialMessages);

    expect(chat).toHaveBeenCalledTimes(3);
    expect(toolCalls).toHaveLength(2);
  });

  it("throws once MAX_TOOL_ROUNDTRIPS is exceeded, rather than looping forever", async () => {
    chat.mockResolvedValue({
      content: null,
      provider: "openrouter",
      model: "test-model",
      finishReason: "tool_calls",
      toolCalls: [toolCall],
    });
    dispatchToolCall.mockResolvedValue({
      id: "call_1",
      name: "check_stock",
      arguments: { productId: 42 },
      status: "succeeded",
      result: 12,
    });

    await expect(runProviderLoop(context, initialMessages)).rejects.toThrow(
      `Tool calling exceeded ${MAX_TOOL_ROUNDTRIPS} round-trips for conversation 1.`
    );
    expect(chat).toHaveBeenCalledTimes(MAX_TOOL_ROUNDTRIPS);
  });
});
