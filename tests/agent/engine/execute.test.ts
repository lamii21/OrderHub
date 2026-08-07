import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  assembleExecutionContext,
  buildPrompt,
  runProviderLoop,
  appendMessage,
  emitAgentEvent,
  maybeSummarizeConversation,
  retrieveRelevantChunks,
} = vi.hoisted(() => ({
  assembleExecutionContext: vi.fn(),
  buildPrompt: vi.fn(),
  runProviderLoop: vi.fn(),
  appendMessage: vi.fn(),
  emitAgentEvent: vi.fn(),
  maybeSummarizeConversation: vi.fn(),
  retrieveRelevantChunks: vi.fn(),
}));

vi.mock("@/lib/agent/context/service", () => ({ assembleExecutionContext }));
vi.mock("@/lib/agent/prompt/builder", () => ({ buildPrompt }));
vi.mock("@/lib/agent/engine/provider-loop", () => ({ runProviderLoop }));
vi.mock("@/lib/agent/conversation/service", () => ({ appendMessage }));
vi.mock("@/lib/agent/events", () => ({ emitAgentEvent }));
vi.mock("@/lib/agent/summary/service", () => ({ maybeSummarizeConversation }));
vi.mock("@/lib/agent/rag/retriever", () => ({ retrieveRelevantChunks }));

import { executeConversation } from "@/lib/agent/engine/execute";
import type { AgentExecutionContext } from "@/lib/agent/engine/types";
import type { AgentConversation, AgentMessage, AgentToolCall } from "@/lib/agent/types";

const activeContext: AgentExecutionContext = {
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
      created_at: "2026-08-05T10:00:00.000Z",
      last_message_at: "2026-08-05T10:00:00.000Z",
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
    languages: ["fr", "en", "ar-ma"],
    ai_provider: "openrouter",
    ai_model: "test-model",
    enabled_tools: [],
    rag_enabled: false,
    rag_top_k: null,
  },
  credentials: { apiKey: "sk-or-test", model: "test-model" },
  options: {},
  retrieved_context: [],
};

const chatResult = {
  content: "Wah, kayn 3 modèles.",
  provider: "openrouter",
  model: "test-model",
  finishReason: "stop" as const,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

const persistedConversation: AgentConversation = {
  ...activeContext.conversation_context.conversation,
  last_message_at: "2026-08-05T10:05:00.000Z",
};

const persistedMessage: AgentMessage = {
  id: 99,
  conversation_id: 1,
  role: "assistant",
  content: chatResult.content,
  content_type: "text",
  detected_language: null,
  detected_intent: null,
  sentiment_score: null,
  confidence_score: null,
  metadata: {
    provider: "openrouter",
    model: "test-model",
    finish_reason: "stop",
    token_usage: chatResult.usage,
  },
  created_at: "2026-08-05T10:05:00.000Z",
};

beforeEach(() => {
  assembleExecutionContext.mockReset().mockImplementation(async (_conversationId: number, options = {}) => ({
    ...activeContext,
    options,
  }));
  buildPrompt.mockReset().mockReturnValue([{ role: "system", content: "system prompt" }]);
  runProviderLoop.mockReset().mockResolvedValue({ result: chatResult, toolCalls: [] });
  appendMessage.mockReset().mockResolvedValue({ conversation: persistedConversation, message: persistedMessage });
  emitAgentEvent.mockReset().mockResolvedValue(undefined);
  maybeSummarizeConversation.mockReset().mockResolvedValue(undefined);
  retrieveRelevantChunks.mockReset().mockResolvedValue([]);
});

describe("executeConversation", () => {
  it("loads context, builds the prompt, runs the provider loop, and persists the reply", async () => {
    const result = await executeConversation({ conversation_id: 1 });

    expect(assembleExecutionContext).toHaveBeenCalledWith(1, {});
    expect(buildPrompt).toHaveBeenCalledWith(activeContext);
    expect(runProviderLoop).toHaveBeenCalledWith(activeContext, [{ role: "system", content: "system prompt" }]);
    expect(appendMessage).toHaveBeenCalledWith({
      conversation_id: 1,
      role: "assistant",
      content: chatResult.content,
      metadata: expect.objectContaining({
        provider: "openrouter",
        model: "test-model",
        finish_reason: "stop",
        token_usage: chatResult.usage,
        latency_ms: expect.any(Number),
      }),
    });
    expect(result).toEqual({ conversation: persistedConversation, message: persistedMessage });

    expect(emitAgentEvent).toHaveBeenNthCalledWith(1, "conversation.started", {
      conversation: activeContext.conversation_context.conversation,
    });
    expect(emitAgentEvent).toHaveBeenNthCalledWith(2, "conversation.responded", {
      conversation: persistedConversation,
      message: persistedMessage,
    });
    expect(emitAgentEvent).toHaveBeenNthCalledWith(3, "conversation.completed", {
      conversation: persistedConversation,
      message: persistedMessage,
    });

    expect(maybeSummarizeConversation).toHaveBeenCalledWith(
      expect.objectContaining({ agent_config: activeContext.agent_config })
    );
  });

  it("forwards options to context assembly", async () => {
    await executeConversation({ conversation_id: 1 }, { max_recent_messages: 5 });
    expect(assembleExecutionContext).toHaveBeenCalledWith(1, { max_recent_messages: 5 });
  });

  it("refuses to run when the shop's agent is not active, without ever running the provider loop", async () => {
    assembleExecutionContext.mockResolvedValue({
      ...activeContext,
      agent_config: { ...activeContext.agent_config, is_active: false },
    });

    await expect(executeConversation({ conversation_id: 1 })).rejects.toThrow(
      "AI agent is not active for shop 15"
    );
    expect(runProviderLoop).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
    expect(emitAgentEvent).not.toHaveBeenCalled();
    expect(maybeSummarizeConversation).not.toHaveBeenCalled();
  });

  it("propagates a context assembly failure without running the provider loop", async () => {
    assembleExecutionContext.mockRejectedValue(new Error("no AI agent configured for shop 15"));

    await expect(executeConversation({ conversation_id: 1 })).rejects.toThrow(
      "no AI agent configured for shop 15"
    );
    expect(runProviderLoop).not.toHaveBeenCalled();
  });

  it("propagates a provider loop failure as-is, without persisting anything or publishing responded/completed", async () => {
    runProviderLoop.mockRejectedValue(new Error("rate limit exceeded"));

    await expect(executeConversation({ conversation_id: 1 })).rejects.toThrow("rate limit exceeded");
    expect(appendMessage).not.toHaveBeenCalled();
    // "started" still fires — the turn did begin — but nothing past it does.
    expect(emitAgentEvent).toHaveBeenCalledTimes(1);
    expect(emitAgentEvent).toHaveBeenCalledWith("conversation.started", expect.anything());
    expect(maybeSummarizeConversation).not.toHaveBeenCalled();
  });

  it("refuses to persist a null-content response instead of writing an empty message, and never publishes responded/completed", async () => {
    runProviderLoop.mockResolvedValue({ result: { ...chatResult, content: null }, toolCalls: [] });

    await expect(executeConversation({ conversation_id: 1 })).rejects.toThrow(
      'Provider "openrouter" returned no content to persist.'
    );
    expect(appendMessage).not.toHaveBeenCalled();
    expect(emitAgentEvent).toHaveBeenCalledTimes(1);
    expect(emitAgentEvent).toHaveBeenCalledWith("conversation.started", expect.anything());
    expect(maybeSummarizeConversation).not.toHaveBeenCalled();
  });

  it("omits token_usage from metadata when the provider result has none", async () => {
    runProviderLoop.mockResolvedValue({ result: { ...chatResult, usage: undefined }, toolCalls: [] });

    await executeConversation({ conversation_id: 1 });

    const metadata = appendMessage.mock.calls[0][0].metadata;
    expect(metadata).not.toHaveProperty("token_usage");
  });

  it("attaches the tool call trail to metadata.tool_calls when the loop reports any, and omits it otherwise", async () => {
    const toolCalls: AgentToolCall[] = [
      { id: "call_1", name: "check_stock", arguments: { productId: 42 }, status: "succeeded", result: { inStock: 12 } },
    ];
    runProviderLoop.mockResolvedValue({ result: chatResult, toolCalls });

    await executeConversation({ conversation_id: 1 });

    expect(appendMessage.mock.calls[0][0].metadata.tool_calls).toEqual(toolCalls);
  });
});

describe("executeConversation — retrieveContext (Phase 8)", () => {
  const userMessage: AgentMessage = {
    id: 50,
    conversation_id: 1,
    role: "user",
    content: "wach 3andkoum stock?",
    content_type: "text",
    detected_language: null,
    detected_intent: null,
    sentiment_score: null,
    confidence_score: null,
    metadata: {},
    created_at: "2026-08-05T09:59:00.000Z",
  };

  it("never calls the retriever when rag_enabled is false, and retrieved_context stays empty", async () => {
    assembleExecutionContext.mockResolvedValue({
      ...activeContext,
      conversation_context: { ...activeContext.conversation_context, recent_messages: [userMessage] },
    });

    await executeConversation({ conversation_id: 1 });

    expect(retrieveRelevantChunks).not.toHaveBeenCalled();
    expect(buildPrompt.mock.calls[0][0].retrieved_context).toEqual([]);
  });

  it("calls the retriever with the shop id, the latest user message, and rag_top_k when rag is enabled", async () => {
    const chunks = [{ document_type: "faq" as const, title: "Livraison", content: "Nous livrons au Maroc.", score: 0.9 }];
    retrieveRelevantChunks.mockResolvedValue(chunks);
    assembleExecutionContext.mockResolvedValue({
      ...activeContext,
      agent_config: { ...activeContext.agent_config, rag_enabled: true, rag_top_k: 8 },
      conversation_context: { ...activeContext.conversation_context, recent_messages: [userMessage] },
    });

    await executeConversation({ conversation_id: 1 });

    expect(retrieveRelevantChunks).toHaveBeenCalledWith(15, "wach 3andkoum stock?", 8);
    expect(buildPrompt.mock.calls[0][0].retrieved_context).toEqual(chunks);
    expect(runProviderLoop.mock.calls[0][0].retrieved_context).toEqual(chunks);
  });

  it("passes undefined (not null) for rag_top_k so the retriever's own platform default applies", async () => {
    assembleExecutionContext.mockResolvedValue({
      ...activeContext,
      agent_config: { ...activeContext.agent_config, rag_enabled: true, rag_top_k: null },
      conversation_context: { ...activeContext.conversation_context, recent_messages: [userMessage] },
    });

    await executeConversation({ conversation_id: 1 });

    expect(retrieveRelevantChunks).toHaveBeenCalledWith(15, "wach 3andkoum stock?", undefined);
  });

  it("never calls the retriever when rag is enabled but there is no user message to search from", async () => {
    assembleExecutionContext.mockResolvedValue({
      ...activeContext,
      agent_config: { ...activeContext.agent_config, rag_enabled: true },
      conversation_context: { ...activeContext.conversation_context, recent_messages: [] },
    });

    await executeConversation({ conversation_id: 1 });

    expect(retrieveRelevantChunks).not.toHaveBeenCalled();
  });

  it("uses the most recent user message, skipping a trailing non-user message rather than reading the array's last entry blindly", async () => {
    const olderUserMessage: AgentMessage = { ...userMessage, id: 40, content: "bghit nchouf les produits" };
    const trailingAssistantMessage: AgentMessage = { ...userMessage, id: 51, role: "assistant", content: "Voici nos produits." };
    assembleExecutionContext.mockResolvedValue({
      ...activeContext,
      agent_config: { ...activeContext.agent_config, rag_enabled: true },
      conversation_context: {
        ...activeContext.conversation_context,
        recent_messages: [olderUserMessage, userMessage, trailingAssistantMessage],
      },
    });

    await executeConversation({ conversation_id: 1 });

    expect(retrieveRelevantChunks).toHaveBeenCalledWith(15, "wach 3andkoum stock?", undefined);
  });
});
