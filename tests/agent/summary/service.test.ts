import { describe, it, expect, vi, beforeEach } from "vitest";

const { countMessages, updateSummary, shouldSummarize, generateSummary } = vi.hoisted(() => ({
  countMessages: vi.fn(),
  updateSummary: vi.fn(),
  shouldSummarize: vi.fn(),
  generateSummary: vi.fn(),
}));

vi.mock("@/lib/agent/conversation/service", () => ({ countMessages }));
vi.mock("@/lib/agent/memory/conversation-memory", () => ({ updateSummary }));
vi.mock("@/lib/agent/summary/trigger", () => ({ shouldSummarize }));
vi.mock("@/lib/agent/summary/generate", () => ({ generateSummary }));

import { maybeSummarizeConversation } from "@/lib/agent/summary/service";
import type { AgentExecutionContext } from "@/lib/agent/engine/types";

const recentMessages = [
  {
    id: 1,
    conversation_id: 1,
    role: "user" as const,
    content: "wach kayn had produit?",
    content_type: "text" as const,
    detected_language: null,
    detected_intent: null,
    sentiment_score: null,
    confidence_score: null,
    metadata: {},
    created_at: "2026-08-06T10:00:00.000Z",
  },
];

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
    recent_messages: recentMessages,
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
    rag_enabled: false,
    rag_top_k: null,
  },
  credentials: { apiKey: "sk-or-test", model: "test-model" },
  options: {},
  retrieved_context: [],
};

beforeEach(() => {
  countMessages.mockReset().mockResolvedValue(10);
  updateSummary.mockReset().mockResolvedValue(undefined);
  shouldSummarize.mockReset().mockReturnValue(true);
  generateSummary.mockReset().mockResolvedValue("Client is deciding between two jacket sizes.");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("maybeSummarizeConversation", () => {
  it("does nothing when the threshold hasn't been reached", async () => {
    shouldSummarize.mockReturnValue(false);

    await maybeSummarizeConversation(context);

    expect(generateSummary).not.toHaveBeenCalled();
    expect(updateSummary).not.toHaveBeenCalled();
  });

  it("generates and persists a summary once the threshold is reached", async () => {
    await maybeSummarizeConversation(context);

    expect(countMessages).toHaveBeenCalledWith(1);
    expect(shouldSummarize).toHaveBeenCalledWith(10);
    expect(generateSummary).toHaveBeenCalledWith(context, recentMessages);
    expect(updateSummary).toHaveBeenCalledWith(1, "Client is deciding between two jacket sizes.");
  });

  it("swallows a provider failure instead of throwing, since this is best-effort", async () => {
    generateSummary.mockRejectedValue(new Error("rate limit exceeded"));

    await expect(maybeSummarizeConversation(context)).resolves.toBeUndefined();
    expect(updateSummary).not.toHaveBeenCalled();
  });

  it("swallows a persistence failure instead of throwing", async () => {
    updateSummary.mockRejectedValue(new Error("too many concurrent writes"));

    await expect(maybeSummarizeConversation(context)).resolves.toBeUndefined();
  });

  it("swallows a countMessages failure instead of throwing", async () => {
    countMessages.mockRejectedValue(new Error("db down"));

    await expect(maybeSummarizeConversation(context)).resolves.toBeUndefined();
    expect(shouldSummarize).not.toHaveBeenCalled();
  });
});
