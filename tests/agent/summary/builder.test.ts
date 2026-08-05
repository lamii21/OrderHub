import { describe, it, expect } from "vitest";
import { buildSummaryPrompt } from "@/lib/agent/summary/builder";
import type { AgentMessage } from "@/lib/agent/types";

function message(overrides: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    conversation_id: 1,
    role: "user",
    content: "hi",
    content_type: "text",
    detected_language: null,
    detected_intent: null,
    sentiment_score: null,
    confidence_score: null,
    metadata: {},
    created_at: "2026-08-06T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildSummaryPrompt", () => {
  it("puts the summarization instructions in the system message when there is no previous summary", () => {
    const [systemMessage] = buildSummaryPrompt(undefined, []);

    expect(systemMessage.role).toBe("system");
    expect(systemMessage.content).toContain("summarize a customer service conversation");
    expect(systemMessage.content).not.toContain("Previous summary:");
  });

  it("folds a previous summary into the system message rather than as a separate turn", () => {
    const [systemMessage] = buildSummaryPrompt("Client wants a size M jacket.", []);

    expect(systemMessage.content).toContain("Previous summary: Client wants a size M jacket.");
  });

  it("translates the conversation history after the system message, in order", () => {
    const messages = [
      message({ role: "user", content: "wach kayn had produit?" }),
      message({ role: "assistant", content: "Wah, kayn 3 modèles." }),
    ];

    const prompt = buildSummaryPrompt(undefined, messages);

    expect(prompt.slice(1)).toEqual([
      { role: "user", content: "wach kayn had produit?" },
      { role: "assistant", content: "Wah, kayn 3 modèles." },
    ]);
  });

  it("is pure: the same input always produces the same output", () => {
    const messages = [message({ content: "same input" })];
    expect(buildSummaryPrompt("prior", messages)).toEqual(buildSummaryPrompt("prior", messages));
  });
});
