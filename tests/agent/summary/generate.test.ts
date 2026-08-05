import { describe, it, expect, vi, beforeEach } from "vitest";

const { getChatProvider, chat, buildSummaryPrompt } = vi.hoisted(() => ({
  getChatProvider: vi.fn(),
  chat: vi.fn(),
  buildSummaryPrompt: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ getChatProvider }));
vi.mock("@/lib/agent/summary/builder", () => ({ buildSummaryPrompt }));

import { generateSummary, SUMMARY_TEMPERATURE } from "@/lib/agent/summary/generate";
import type { AgentExecutionContext } from "@/lib/agent/engine/types";
import type { AgentMessage } from "@/lib/agent/types";

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
      memory: { version: 1, summary: "Client asked about jackets." },
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
    languages: ["fr", "en", "ar-ma"],
    ai_provider: "openrouter",
    ai_model: "test-model",
    enabled_tools: [],
  },
  credentials: { apiKey: "sk-or-test", model: "test-model" },
  options: {},
};

const recentMessages: AgentMessage[] = [];

beforeEach(() => {
  getChatProvider.mockReset().mockReturnValue({ name: "openrouter", chat });
  chat.mockReset().mockResolvedValue({
    content: "Client is deciding between two jacket sizes.",
    provider: "openrouter",
    model: "test-model",
    finishReason: "stop",
  });
  buildSummaryPrompt.mockReset().mockReturnValue([{ role: "system", content: "summarize" }]);
});

describe("generateSummary", () => {
  it("builds the prompt from the conversation's existing summary and recent messages", async () => {
    await generateSummary(context, recentMessages);
    expect(buildSummaryPrompt).toHaveBeenCalledWith("Client asked about jackets.", recentMessages);
  });

  it("calls the shop's own configured provider and credentials, at the fixed summary temperature", async () => {
    await generateSummary(context, recentMessages);

    expect(getChatProvider).toHaveBeenCalledWith("openrouter");
    expect(chat).toHaveBeenCalledWith(context.credentials, [{ role: "system", content: "summarize" }], {
      temperature: SUMMARY_TEMPERATURE,
    });
  });

  it("returns the provider's content", async () => {
    await expect(generateSummary(context, recentMessages)).resolves.toBe(
      "Client is deciding between two jacket sizes."
    );
  });

  it("throws rather than returning an empty string when the provider has no content", async () => {
    chat.mockResolvedValue({ content: null, provider: "openrouter", model: "test-model", finishReason: "stop" });

    await expect(generateSummary(context, recentMessages)).rejects.toThrow(
      'Provider "openrouter" returned no content for a conversation summary.'
    );
  });

  it("propagates a provider failure as-is", async () => {
    chat.mockRejectedValue(new Error("rate limit exceeded"));
    await expect(generateSummary(context, recentMessages)).rejects.toThrow("rate limit exceeded");
  });
});
