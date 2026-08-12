import { describe, it, expect, vi } from "vitest";
import { buildSystemPrompt, toChatMessage, buildPrompt } from "@/lib/agent/prompt/builder";
import type { AgentExecutionContext } from "@/lib/agent/engine/types";
import type { AgentMessage } from "@/lib/agent/types";

function baseContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
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
    credentials: { apiKey: "test-key", model: "test-model" },
    options: {},
    retrieved_context: [],
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("uses the merchant's own system_prompt when set", () => {
    const context = baseContext();
    context.agent_config.system_prompt = "You sell snowboards. Be concise.";

    expect(buildSystemPrompt(context)).toContain("You sell snowboards. Be concise.");
  });

  it("falls back to a plain shop-naming sentence when no system_prompt is configured", () => {
    const prompt = buildSystemPrompt(baseContext());
    expect(prompt).toContain("You are a sales assistant for AYLA.");
  });

  it("always includes the configured tone", () => {
    const context = baseContext();
    context.agent_config.tone = "professional";

    expect(buildSystemPrompt(context)).toContain("Tone: professional.");
  });

  it("lists supported languages when at least one is configured", () => {
    expect(buildSystemPrompt(baseContext())).toContain("fr, en, ar-ma");
  });

  it("omits the languages section entirely when none are configured", () => {
    const context = baseContext();
    context.agent_config.languages = [];

    expect(buildSystemPrompt(context)).not.toContain("Supported languages");
  });

  it("always includes an explicit grounding/abstention instruction (Priority 3 finalisation fix)", () => {
    const prompt = buildSystemPrompt(baseContext());
    expect(prompt).toContain("Only state facts that come from a tool result or from the shop's knowledge base");
    expect(prompt).toContain("say plainly that you don't have that information");
  });

  it("names the customer when known", () => {
    const context = baseContext();
    context.conversation_context.customer = { id: 42, name: "lamiae", phone: "212600000000", email: null };

    expect(buildSystemPrompt(context)).toContain("You are speaking with lamiae.");
  });

  it("says nothing about the customer when none is known", () => {
    expect(buildSystemPrompt(baseContext())).not.toContain("You are speaking with");
  });

  it("says nothing about the customer when known but unnamed", () => {
    const context = baseContext();
    context.conversation_context.customer = { id: 42, name: null, phone: "212600000000", email: null };

    expect(buildSystemPrompt(context)).not.toContain("You are speaking with");
  });

  it("includes the conversation summary when memory has one", () => {
    const context = baseContext();
    context.conversation_context.conversation.memory = { version: 2, summary: "Client wants a size M jacket." };

    expect(buildSystemPrompt(context)).toContain("Conversation summary so far: Client wants a size M jacket.");
  });

  it("includes known facts, formatted as key: value pairs", () => {
    const context = baseContext();
    context.conversation_context.conversation.memory = { version: 2, facts: { size: "M", color: "rose" } };

    expect(buildSystemPrompt(context)).toContain("Known facts about this customer: size: M, color: rose");
  });

  it("includes customer preferences, formatted the same way", () => {
    const context = baseContext();
    context.conversation_context.conversation.memory = { version: 2, preferences: { language: "darija" } };

    expect(buildSystemPrompt(context)).toContain("Customer preferences: language: darija");
  });

  it("omits summary/facts/preferences sections entirely when memory carries none of them", () => {
    const prompt = buildSystemPrompt(baseContext());
    expect(prompt).not.toContain("Conversation summary");
    expect(prompt).not.toContain("Known facts");
    expect(prompt).not.toContain("Customer preferences");
  });

  it("is deterministic: the same context always produces the exact same string", () => {
    const context = baseContext();
    context.conversation_context.conversation.memory = { version: 2, summary: "x", facts: { a: 1 } };

    expect(buildSystemPrompt(context)).toBe(buildSystemPrompt(context));
  });

  it("includes retrieved chunks, attributed by title and document type, when any are present", () => {
    const context = baseContext();
    context.retrieved_context = [
      { document_type: "faq", title: "Livraison", content: "Nous livrons partout au Maroc.", score: 0.9 },
      { document_type: "policy", title: "Retours", content: "Les retours sont acceptés sous 14 jours.", score: 0.81 },
    ];

    const prompt = buildSystemPrompt(context);

    expect(prompt).toContain("Relevant information from the shop's knowledge base:");
    expect(prompt).toContain("- Livraison (faq): Nous livrons partout au Maroc.");
    expect(prompt).toContain("- Retours (policy): Les retours sont acceptés sous 14 jours.");
  });

  it("omits the retrieved-chunks section entirely when nothing was retrieved", () => {
    // "knowledge base" itself still appears — the grounding instruction
    // above references it generically — but the actual content section
    // (formatRetrievedContext's own header) must not.
    expect(buildSystemPrompt(baseContext())).not.toContain("Relevant information from the shop's knowledge base:");
  });

  it("never mentions score/id fields for a retrieved chunk — only title, type, and content reach the prompt", () => {
    const context = baseContext();
    context.retrieved_context = [
      { document_type: "faq", title: "Livraison", content: "Nous livrons partout au Maroc.", score: 0.9 },
    ];

    expect(buildSystemPrompt(context)).not.toMatch(/0\.9/);
  });
});

describe("toChatMessage", () => {
  it("maps role and content, dropping every other AgentMessage field", () => {
    const message: AgentMessage = {
      id: 10,
      conversation_id: 1,
      role: "user",
      content: "wach kayn had produit?",
      content_type: "text",
      detected_language: "ar-ma",
      detected_intent: "product_inquiry",
      sentiment_score: 0.2,
      confidence_score: 0.9,
      metadata: { provider: "openrouter" },
      created_at: "2026-08-05T10:00:00.000Z",
    };

    expect(toChatMessage(message)).toEqual({ role: "user", content: "wach kayn had produit?" });
  });
});

describe("buildPrompt", () => {
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
      created_at: "2026-08-05T10:00:00.000Z",
      ...overrides,
    };
  }

  it("puts the system message first, followed by the conversation history in order", () => {
    const context = baseContext();
    context.conversation_context.recent_messages = [
      message({ role: "user", content: "wach kayn had produit?" }),
      message({ role: "assistant", content: "Wah, kayn!" }),
    ];

    const result = buildPrompt(context);

    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("system");
    expect(result[1]).toEqual({ role: "user", content: "wach kayn had produit?" });
    expect(result[2]).toEqual({ role: "assistant", content: "Wah, kayn!" });
  });

  it("returns just the system message when there is no history yet", () => {
    const result = buildPrompt(baseContext());
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("system");
  });

  it("is fully deterministic: the same context always produces an identical array", () => {
    const context = baseContext();
    context.conversation_context.recent_messages = [message({ content: "hello" })];

    expect(buildPrompt(context)).toEqual(buildPrompt(context));
  });

  it("never calls fetch or performs any I/O", async () => {
    const fetchSpy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      buildPrompt(baseContext());
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
