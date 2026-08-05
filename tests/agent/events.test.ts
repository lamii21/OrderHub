import { describe, it, expect, vi, beforeEach } from "vitest";
import { onAgentEvent, emitAgentEvent, __resetAgentEventHandlers } from "@/lib/agent/events";
import type { AgentConversation } from "@/lib/agent/types";

const conversation: AgentConversation = {
  id: 1,
  shop_id: 15,
  customer_id: null,
  channel: "whatsapp",
  external_thread_id: "212600000000",
  status: "open",
  memory: { version: 1 },
  created_at: "2026-08-04T00:00:00.000Z",
  last_message_at: "2026-08-04T00:00:00.000Z",
  resolved_at: null,
  escalated_at: null,
};

beforeEach(() => {
  __resetAgentEventHandlers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("onAgentEvent / emitAgentEvent", () => {
  it("calls a registered handler with the exact payload it was emitted with", async () => {
    const handler = vi.fn();
    onAgentEvent("conversation.resolved", handler);

    await emitAgentEvent("conversation.resolved", { conversation });

    expect(handler).toHaveBeenCalledWith({ conversation });
  });

  it("calls every handler registered for the same event type", async () => {
    const first = vi.fn();
    const second = vi.fn();
    onAgentEvent("conversation.escalated", first);
    onAgentEvent("conversation.escalated", second);

    await emitAgentEvent("conversation.escalated", { conversation });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("never calls a handler registered for a different event type", async () => {
    const handler = vi.fn();
    onAgentEvent("conversation.resolved", handler);

    await emitAgentEvent("conversation.escalated", { conversation });

    expect(handler).not.toHaveBeenCalled();
  });

  it("resolves without error when nothing is subscribed to that event type", async () => {
    await expect(emitAgentEvent("conversation.abandoned", { conversation })).resolves.toBeUndefined();
  });

  it("does not let a failing handler stop the remaining ones, and does not itself reject", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const succeeding = vi.fn();
    onAgentEvent("conversation.created", failing);
    onAgentEvent("conversation.created", succeeding);

    await expect(emitAgentEvent("conversation.created", { conversation })).resolves.toBeUndefined();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("also isolates a handler that throws synchronously, not just a rejected promise", async () => {
    const throwing = vi.fn(() => {
      throw new Error("sync boom");
    });
    const succeeding = vi.fn();
    onAgentEvent("conversation.created", throwing);
    onAgentEvent("conversation.created", succeeding);

    await emitAgentEvent("conversation.created", { conversation });

    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("passes the message alongside the conversation for message-carrying event types", async () => {
    const handler = vi.fn();
    onAgentEvent("conversation.message_received", handler);
    const message = {
      id: 1,
      conversation_id: conversation.id,
      role: "user" as const,
      content: "wach kayn had produit?",
      content_type: "text" as const,
      detected_language: null,
      detected_intent: null,
      sentiment_score: null,
      confidence_score: null,
      metadata: {},
      created_at: "2026-08-04T00:00:00.000Z",
    };

    await emitAgentEvent("conversation.message_received", { conversation, message });

    expect(handler).toHaveBeenCalledWith({ conversation, message });
  });

  it("emits conversation.started with just the conversation", async () => {
    const handler = vi.fn();
    onAgentEvent("conversation.started", handler);

    await emitAgentEvent("conversation.started", { conversation });

    expect(handler).toHaveBeenCalledWith({ conversation });
  });

  it("emits conversation.responded and conversation.completed as two independent subscriptions", async () => {
    const responded = vi.fn();
    const completed = vi.fn();
    onAgentEvent("conversation.responded", responded);
    onAgentEvent("conversation.completed", completed);
    const message = {
      id: 1,
      conversation_id: conversation.id,
      role: "assistant" as const,
      content: "Wah, kayn 3 modèles.",
      content_type: "text" as const,
      detected_language: null,
      detected_intent: null,
      sentiment_score: null,
      confidence_score: null,
      metadata: {},
      created_at: "2026-08-04T00:00:00.000Z",
    };

    await emitAgentEvent("conversation.responded", { conversation, message });

    expect(responded).toHaveBeenCalledWith({ conversation, message });
    expect(completed).not.toHaveBeenCalled();
  });

  it("__resetAgentEventHandlers clears every subscriber, including across event types", async () => {
    const handler = vi.fn();
    onAgentEvent("conversation.resolved", handler);

    __resetAgentEventHandlers();
    await emitAgentEvent("conversation.resolved", { conversation });

    expect(handler).not.toHaveBeenCalled();
  });
});
