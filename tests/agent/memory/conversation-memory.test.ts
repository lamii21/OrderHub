import { describe, it, expect, vi, beforeEach } from "vitest";

const { findConversationById, updateMemory } = vi.hoisted(() => ({
  findConversationById: vi.fn(),
  updateMemory: vi.fn(),
}));

vi.mock("@/lib/agent/conversation/repository", () => ({ findConversationById, updateMemory }));

import {
  updateConversationMemory,
  getConversationMemory,
  updateSummary,
  setFact,
  setPreference,
} from "@/lib/agent/memory/conversation-memory";
import type { AgentConversation } from "@/lib/agent/types";

const conversation: AgentConversation = {
  id: 1,
  shop_id: 15,
  customer_id: 42,
  channel: "whatsapp",
  external_thread_id: "212600000000",
  status: "open",
  memory: { version: 1, facts: { size: "M" } },
  created_at: "2026-08-05T10:00:00.000Z",
  last_message_at: "2026-08-05T10:00:00.000Z",
  resolved_at: null,
  escalated_at: null,
};

beforeEach(() => {
  findConversationById.mockReset();
  updateMemory.mockReset();
});

describe("updateConversationMemory", () => {
  it("passes the current memory to the updater and persists what it returns", async () => {
    findConversationById.mockResolvedValue(conversation);
    updateMemory.mockResolvedValue({ ...conversation, memory: { version: 2, summary: "new summary" } });

    const updater = vi.fn(() => ({ summary: "new summary" }));
    const result = await updateConversationMemory(1, updater);

    expect(updater).toHaveBeenCalledWith(conversation.memory);
    expect(updateMemory).toHaveBeenCalledWith(1, { summary: "new summary" }, 1);
    expect(result.memory.summary).toBe("new summary");
  });

  it("re-reads the current state and re-applies the updater on a version conflict, instead of failing immediately", async () => {
    const conflictedMemory = { version: 2, summary: "someone else's update" };
    findConversationById
      .mockResolvedValueOnce(conversation)
      .mockResolvedValueOnce({ ...conversation, memory: conflictedMemory });
    updateMemory
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...conversation, memory: { version: 3, summary: "retried" } });

    const updater = vi.fn(() => ({ summary: "retried" }));
    const result = await updateConversationMemory(1, updater);

    expect(updater).toHaveBeenCalledTimes(2);
    expect(updater).toHaveBeenNthCalledWith(2, conflictedMemory);
    expect(updateMemory).toHaveBeenNthCalledWith(2, 1, { summary: "retried" }, 2);
    expect(result.memory.summary).toBe("retried");
  });

  it("throws after exhausting all retry attempts under sustained conflict", async () => {
    findConversationById.mockResolvedValue(conversation);
    updateMemory.mockResolvedValue(null);

    await expect(updateConversationMemory(1, () => ({ summary: "x" }))).rejects.toThrow(
      "too many concurrent writes"
    );
    expect(updateMemory).toHaveBeenCalledTimes(3);
  });

  it("throws immediately when the conversation does not exist, without attempting a write", async () => {
    findConversationById.mockResolvedValue(null);

    await expect(updateConversationMemory(999, () => ({ summary: "x" }))).rejects.toThrow(
      "conversation 999 does not exist"
    );
    expect(updateMemory).not.toHaveBeenCalled();
  });
});

describe("getConversationMemory", () => {
  it("returns the conversation's memory", async () => {
    findConversationById.mockResolvedValue(conversation);
    await expect(getConversationMemory(1)).resolves.toEqual(conversation.memory);
  });

  it("returns null when the conversation does not exist", async () => {
    findConversationById.mockResolvedValue(null);
    await expect(getConversationMemory(999)).resolves.toBeNull();
  });
});

describe("updateSummary", () => {
  it("sets the summary and stamps summary_updated_at, without dropping existing facts", async () => {
    findConversationById.mockResolvedValue(conversation);
    updateMemory.mockResolvedValue({
      ...conversation,
      memory: { version: 2, facts: { size: "M" }, summary: "Client wants a size M jacket." },
    });

    await updateSummary(1, "Client wants a size M jacket.");

    const [, content] = updateMemory.mock.calls[0];
    expect(content.summary).toBe("Client wants a size M jacket.");
    expect(content.summary_updated_at).toBeTypeOf("string");
    expect(content.facts).toEqual({ size: "M" });
  });
});

describe("setFact", () => {
  it("merges a new fact into the existing facts object rather than replacing it", async () => {
    findConversationById.mockResolvedValue(conversation);
    updateMemory.mockResolvedValue(conversation);

    await setFact(1, "color", "rose");

    const [, content] = updateMemory.mock.calls[0];
    expect(content.facts).toEqual({ size: "M", color: "rose" });
  });

  it("starts a facts object from scratch when none existed yet", async () => {
    findConversationById.mockResolvedValue({ ...conversation, memory: { version: 1 } });
    updateMemory.mockResolvedValue(conversation);

    await setFact(1, "color", "rose");

    const [, content] = updateMemory.mock.calls[0];
    expect(content.facts).toEqual({ color: "rose" });
  });
});

describe("setPreference", () => {
  it("merges a new preference into the existing preferences object", async () => {
    findConversationById.mockResolvedValue({
      ...conversation,
      memory: { version: 1, preferences: { language: "darija" } },
    });
    updateMemory.mockResolvedValue(conversation);

    await setPreference(1, "tone", "casual");

    const [, content] = updateMemory.mock.calls[0];
    expect(content.preferences).toEqual({ language: "darija", tone: "casual" });
  });
});
