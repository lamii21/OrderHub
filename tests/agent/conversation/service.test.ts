import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  insertConversationIfNew,
  upsertConversation,
  findConversationById,
  updateConversation,
  insertMessage,
  listRecentMessages,
  countMessages,
  emitAgentEvent,
} = vi.hoisted(() => ({
  insertConversationIfNew: vi.fn(),
  upsertConversation: vi.fn(),
  findConversationById: vi.fn(),
  updateConversation: vi.fn(),
  insertMessage: vi.fn(),
  listRecentMessages: vi.fn(),
  countMessages: vi.fn(),
  emitAgentEvent: vi.fn(),
}));

vi.mock("@/lib/agent/conversation/repository", () => ({
  insertConversationIfNew,
  upsertConversation,
  findConversationById,
  updateConversation,
  insertMessage,
  listRecentMessages,
  countMessages,
}));

vi.mock("@/lib/agent/events", () => ({ emitAgentEvent }));

import {
  resolveConversation,
  appendMessage,
  transitionConversationStatus,
  getConversation,
  getRecentMessages,
  countMessages as countConversationMessages,
  computeConversationState,
} from "@/lib/agent/conversation/service";
import type { AgentConversation, AgentMessage } from "@/lib/agent/types";

const conversation: AgentConversation = {
  id: 1,
  shop_id: 15,
  customer_id: 42,
  channel: "whatsapp",
  external_thread_id: "212600000000",
  status: "open",
  memory: { version: 1 },
  created_at: "2026-08-04T10:00:00.000Z",
  last_message_at: "2026-08-04T10:00:00.000Z",
  resolved_at: null,
  escalated_at: null,
};

beforeEach(() => {
  insertConversationIfNew.mockReset();
  upsertConversation.mockReset();
  findConversationById.mockReset();
  updateConversation.mockReset();
  insertMessage.mockReset();
  listRecentMessages.mockReset();
  countMessages.mockReset();
  emitAgentEvent.mockReset().mockResolvedValue(undefined);
});

describe("resolveConversation", () => {
  it("emits conversation.created and skips the fallback upsert when the insert wins", async () => {
    insertConversationIfNew.mockResolvedValue(conversation);

    const result = await resolveConversation({
      shop_id: 15,
      channel: "whatsapp",
      external_thread_id: "212600000000",
    });

    expect(result).toBe(conversation);
    expect(upsertConversation).not.toHaveBeenCalled();
    expect(emitAgentEvent).toHaveBeenCalledWith("conversation.created", { conversation });
  });

  it("falls back to a plain upsert and never emits conversation.created when the thread already existed", async () => {
    insertConversationIfNew.mockResolvedValue(null);
    upsertConversation.mockResolvedValue(conversation);

    const result = await resolveConversation({
      shop_id: 15,
      channel: "whatsapp",
      external_thread_id: "212600000000",
      customer_id: 42,
    });

    expect(result).toBe(conversation);
    expect(upsertConversation).toHaveBeenCalledWith({
      shop_id: 15,
      channel: "whatsapp",
      external_thread_id: "212600000000",
      customer_id: 42,
    });
    expect(emitAgentEvent).not.toHaveBeenCalled();
  });
});

describe("appendMessage", () => {
  const message: AgentMessage = {
    id: 10,
    conversation_id: 1,
    role: "user",
    content: "wach kayn had produit?",
    content_type: "text",
    detected_language: null,
    detected_intent: null,
    sentiment_score: null,
    confidence_score: null,
    metadata: {},
    created_at: "2026-08-04T10:05:00.000Z",
  };

  it("inserts the message, moves last_message_at to the message's own timestamp, and emits conversation.message_received", async () => {
    insertMessage.mockResolvedValue(message);
    updateConversation.mockResolvedValue({ ...conversation, last_message_at: message.created_at });

    const result = await appendMessage({ conversation_id: 1, role: "user", content: "wach kayn had produit?" });

    expect(result.message).toBe(message);
    expect(result.conversation).toEqual({ ...conversation, last_message_at: message.created_at });
    expect(updateConversation).toHaveBeenCalledWith(1, { last_message_at: message.created_at });
    expect(emitAgentEvent).toHaveBeenCalledWith("conversation.message_received", {
      conversation: { ...conversation, last_message_at: message.created_at },
      message,
    });
  });

  it("rejects empty content before ever touching the repository", async () => {
    await expect(appendMessage({ conversation_id: 1, role: "user", content: "   " })).rejects.toThrow(
      "Message content cannot be empty."
    );
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it("rejects content over the length limit before ever touching the repository", async () => {
    const tooLong = "a".repeat(4001);
    await expect(appendMessage({ conversation_id: 1, role: "user", content: tooLong })).rejects.toThrow(
      "exceeds the 4000 character limit"
    );
    expect(insertMessage).not.toHaveBeenCalled();
  });
});

describe("transitionConversationStatus", () => {
  it("stamps resolved_at and emits conversation.resolved when moving to resolved", async () => {
    const resolved = { ...conversation, status: "resolved" as const, resolved_at: "2026-08-04T11:00:00.000Z" };
    updateConversation.mockResolvedValue(resolved);

    const result = await transitionConversationStatus(1, "resolved");

    expect(result).toBe(resolved);
    const patch = updateConversation.mock.calls[0][1];
    expect(patch.status).toBe("resolved");
    expect(patch.resolved_at).toBeTypeOf("string");
    expect(patch).not.toHaveProperty("escalated_at");
    expect(emitAgentEvent).toHaveBeenCalledWith("conversation.resolved", { conversation: resolved });
  });

  it("stamps escalated_at and emits conversation.escalated when moving to escalated", async () => {
    const escalated = { ...conversation, status: "escalated" as const, escalated_at: "2026-08-04T11:00:00.000Z" };
    updateConversation.mockResolvedValue(escalated);

    await transitionConversationStatus(1, "escalated");

    const patch = updateConversation.mock.calls[0][1];
    expect(patch.escalated_at).toBeTypeOf("string");
    expect(patch).not.toHaveProperty("resolved_at");
    expect(emitAgentEvent).toHaveBeenCalledWith("conversation.escalated", { conversation: escalated });
  });

  it("stamps neither timestamp and emits nothing when moving to open", async () => {
    const reopened = { ...conversation, status: "open" as const };
    updateConversation.mockResolvedValue(reopened);

    await transitionConversationStatus(1, "open");

    const patch = updateConversation.mock.calls[0][1];
    expect(patch).toEqual({ status: "open" });
    expect(emitAgentEvent).not.toHaveBeenCalled();
  });
});

describe("getConversation / getRecentMessages", () => {
  it("getConversation delegates directly to the repository", async () => {
    findConversationById.mockResolvedValue(conversation);
    await expect(getConversation(1)).resolves.toBe(conversation);
    expect(findConversationById).toHaveBeenCalledWith(1);
  });

  it("getRecentMessages delegates directly to the repository", async () => {
    listRecentMessages.mockResolvedValue([]);
    await expect(getRecentMessages(1, 20)).resolves.toEqual([]);
    expect(listRecentMessages).toHaveBeenCalledWith(1, 20);
  });

  it("countMessages delegates directly to the repository", async () => {
    countMessages.mockResolvedValue(10);
    await expect(countConversationMessages(1)).resolves.toBe(10);
    expect(countMessages).toHaveBeenCalledWith(1);
  });
});

describe("computeConversationState", () => {
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
      created_at: "2026-08-04T10:00:00.000Z",
      ...overrides,
    };
  }

  it("is waiting on the agent when the customer's last message is newer than the assistant's", () => {
    const messages = [
      message({ role: "assistant", created_at: "2026-08-04T10:00:00.000Z" }),
      message({ role: "user", created_at: "2026-08-04T10:05:00.000Z" }),
    ];

    const state = computeConversationState(conversation, messages);

    expect(state.is_waiting_on_agent).toBe(true);
    expect(state.last_customer_message_at).toBe("2026-08-04T10:05:00.000Z");
  });

  it("is not waiting on the agent once the assistant's reply is the most recent message", () => {
    const messages = [
      message({ role: "user", created_at: "2026-08-04T10:00:00.000Z" }),
      message({ role: "assistant", created_at: "2026-08-04T10:05:00.000Z" }),
    ];

    expect(computeConversationState(conversation, messages).is_waiting_on_agent).toBe(false);
  });

  it("is not waiting on the agent when no customer message exists yet", () => {
    expect(computeConversationState(conversation, []).is_waiting_on_agent).toBe(false);
  });

  it("unresolved_since is the conversation's created_at for any non-resolved status", () => {
    expect(computeConversationState({ ...conversation, status: "open" }, []).unresolved_since).toBe(
      conversation.created_at
    );
    expect(computeConversationState({ ...conversation, status: "escalated" }, []).unresolved_since).toBe(
      conversation.created_at
    );
  });

  it("unresolved_since is null once the conversation is resolved", () => {
    expect(computeConversationState({ ...conversation, status: "resolved" }, []).unresolved_since).toBeNull();
  });
});
