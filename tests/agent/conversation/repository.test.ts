import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import {
  upsertConversation,
  insertConversationIfNew,
  findConversationById,
  updateConversation,
  updateMemory,
  insertMessage,
  listRecentMessages,
} from "@/lib/agent/conversation/repository";

const conversationRow = {
  id: 1,
  shop_id: 15,
  customer_id: 42,
  channel: "whatsapp",
  external_thread_id: "212600000000",
  status: "open",
  memory: { summary: "Client asks about snowboards." },
  memory_version: 3,
  created_at: "2026-08-04T10:00:00.000Z",
  last_message_at: "2026-08-04T10:05:00.000Z",
  resolved_at: null,
  escalated_at: null,
};

describe("upsertConversation", () => {
  it("upserts on (shop_id, channel, external_thread_id) and maps memory + memory_version into one ConversationMemory object", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_conversations: { data: conversationRow, error: null } },
    });
    holder.client = client;

    const result = await upsertConversation({
      shop_id: 15,
      channel: "whatsapp",
      external_thread_id: "212600000000",
      customer_id: 42,
    });

    expect(builders.agent_conversations[0].upsert).toHaveBeenCalledWith(
      { shop_id: 15, channel: "whatsapp", external_thread_id: "212600000000", customer_id: 42 },
      { onConflict: "shop_id,channel,external_thread_id" }
    );
    expect(result.memory).toEqual({ summary: "Client asks about snowboards.", version: 3 });
    expect(result.id).toBe(1);
  });

  it("omits customer_id entirely when not provided, never overwriting an existing one on conflict", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_conversations: { data: conversationRow, error: null } },
    });
    holder.client = client;

    await upsertConversation({ shop_id: 15, channel: "whatsapp", external_thread_id: "212600000000" });

    const payload = builders.agent_conversations[0].upsert.mock.calls[0][0];
    expect(payload).not.toHaveProperty("customer_id");
  });

  it("includes an explicit null customer_id (distinct from omitting it)", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_conversations: { data: conversationRow, error: null } },
    });
    holder.client = client;

    await upsertConversation({
      shop_id: 15,
      channel: "whatsapp",
      external_thread_id: "212600000000",
      customer_id: null,
    });

    expect(builders.agent_conversations[0].upsert.mock.calls[0][0]).toHaveProperty("customer_id", null);
  });

  it("throws when the upsert fails", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: null, error: { message: "constraint violation" } } },
    });
    holder.client = client;

    await expect(
      upsertConversation({ shop_id: 15, channel: "whatsapp", external_thread_id: "212600000000" })
    ).rejects.toThrow("constraint violation");
  });
});

describe("insertConversationIfNew", () => {
  it("passes ignoreDuplicates: true so it only ever reports a genuine insert", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_conversations: { data: conversationRow, error: null } },
    });
    holder.client = client;

    await insertConversationIfNew({ shop_id: 15, channel: "whatsapp", external_thread_id: "212600000000" });

    expect(builders.agent_conversations[0].upsert).toHaveBeenCalledWith(
      { shop_id: 15, channel: "whatsapp", external_thread_id: "212600000000" },
      { onConflict: "shop_id,channel,external_thread_id", ignoreDuplicates: true }
    );
  });

  it("returns the mapped conversation when the insert wins", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: conversationRow, error: null } },
    });
    holder.client = client;

    const result = await insertConversationIfNew({
      shop_id: 15,
      channel: "whatsapp",
      external_thread_id: "212600000000",
    });

    expect(result?.id).toBe(1);
  });

  it("returns null when the thread already existed (ignoreDuplicates skipped the insert)", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: null, error: null } },
    });
    holder.client = client;

    await expect(
      insertConversationIfNew({ shop_id: 15, channel: "whatsapp", external_thread_id: "212600000000" })
    ).resolves.toBeNull();
  });

  it("throws on a genuine query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(
      insertConversationIfNew({ shop_id: 15, channel: "whatsapp", external_thread_id: "212600000000" })
    ).rejects.toThrow("db down");
  });
});

describe("findConversationById", () => {
  it("returns the mapped conversation when found", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: conversationRow, error: null } },
    });
    holder.client = client;

    const result = await findConversationById(1);

    expect(result?.id).toBe(1);
    expect(result?.memory.version).toBe(3);
  });

  it("returns null when no row matches", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: null, error: null } },
    });
    holder.client = client;

    await expect(findConversationById(999)).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(findConversationById(1)).rejects.toThrow("db down");
  });

  it("defaults memory to an empty object plus the current version when the column is null", async () => {
    const { client } = createMockSupabase({
      responses: {
        agent_conversations: { data: { ...conversationRow, memory: null, memory_version: 1 }, error: null },
      },
    });
    holder.client = client;

    const result = await findConversationById(1);

    expect(result?.memory).toEqual({ version: 1 });
  });
});

describe("updateConversation", () => {
  it("writes exactly the patch it was given, filtered by id", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_conversations: { data: { ...conversationRow, status: "resolved" }, error: null } },
    });
    holder.client = client;

    await updateConversation(1, { status: "resolved", resolved_at: "2026-08-04T11:00:00.000Z" });

    expect(builders.agent_conversations[0].update).toHaveBeenCalledWith({
      status: "resolved",
      resolved_at: "2026-08-04T11:00:00.000Z",
    });
    expect(builders.agent_conversations[0].eq).toHaveBeenCalledWith("id", 1);
  });

  it("throws when the update fails", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: null, error: { message: "row not found" } } },
    });
    holder.client = client;

    await expect(updateConversation(1, { status: "escalated" })).rejects.toThrow("row not found");
  });
});

describe("updateMemory", () => {
  it("increments memory_version and scopes the update to the expected current version", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        agent_conversations: {
          data: { ...conversationRow, memory: { summary: "updated" }, memory_version: 4 },
          error: null,
        },
      },
    });
    holder.client = client;

    const result = await updateMemory(1, { summary: "updated" }, 3);

    expect(builders.agent_conversations[0].update).toHaveBeenCalledWith({
      memory: { summary: "updated" },
      memory_version: 4,
    });
    expect(builders.agent_conversations[0].eq).toHaveBeenNthCalledWith(1, "id", 1);
    expect(builders.agent_conversations[0].eq).toHaveBeenNthCalledWith(2, "memory_version", 3);
    expect(result?.memory).toEqual({ summary: "updated", version: 4 });
  });

  it("returns null (a version conflict) rather than throwing when no row matches the expected version", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: null, error: null } },
    });
    holder.client = client;

    await expect(updateMemory(1, { summary: "updated" }, 3)).resolves.toBeNull();
  });

  it("throws on a genuine query error, distinct from a version conflict", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(updateMemory(1, { summary: "updated" }, 3)).rejects.toThrow("db down");
  });
});

const messageRow = {
  id: 10,
  conversation_id: 1,
  role: "user",
  content: "wach kayn had produit?",
  content_type: "text",
  detected_language: "ar-ma",
  detected_intent: "product_inquiry",
  sentiment_score: null,
  confidence_score: null,
  metadata: {},
  created_at: "2026-08-04T10:00:00.000Z",
};

describe("insertMessage", () => {
  it("inserts the required fields and maps the returned row", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_messages: { data: messageRow, error: null } },
    });
    holder.client = client;

    const result = await insertMessage({ conversation_id: 1, role: "user", content: "wach kayn had produit?" });

    expect(builders.agent_messages[0].insert).toHaveBeenCalledWith({
      conversation_id: 1,
      role: "user",
      content: "wach kayn had produit?",
    });
    expect(result.id).toBe(10);
    expect(result.detected_language).toBe("ar-ma");
  });

  it("includes optional fields only when explicitly provided", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_messages: { data: messageRow, error: null } },
    });
    holder.client = client;

    await insertMessage({
      conversation_id: 1,
      role: "assistant",
      content: "Wah, kayn 3 modèles.",
      detected_language: "ar-ma",
      metadata: { provider: "openrouter", model: "test-model" },
    });

    const payload = builders.agent_messages[0].insert.mock.calls[0][0];
    expect(payload).toMatchObject({ detected_language: "ar-ma", metadata: { provider: "openrouter", model: "test-model" } });
    expect(payload).not.toHaveProperty("sentiment_score");
    expect(payload).not.toHaveProperty("content_type");
  });

  it("throws when the insert fails", async () => {
    const { client } = createMockSupabase({
      responses: { agent_messages: { data: null, error: { message: "insert failed" } } },
    });
    holder.client = client;

    await expect(insertMessage({ conversation_id: 1, role: "user", content: "hi" })).rejects.toThrow(
      "insert failed"
    );
  });
});

describe("listRecentMessages", () => {
  it("queries newest-first with the given limit, but returns oldest-first", async () => {
    const newer = { ...messageRow, id: 11, content: "second message", created_at: "2026-08-04T10:01:00.000Z" };
    const { client, builders } = createMockSupabase({
      responses: { agent_messages: { data: [newer, messageRow], error: null } },
    });
    holder.client = client;

    const result = await listRecentMessages(1, 20);

    expect(builders.agent_messages[0].order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(builders.agent_messages[0].limit).toHaveBeenCalledWith(20);
    expect(result.map((m) => m.id)).toEqual([10, 11]);
  });

  it("returns an empty array, not null, when there are no messages yet", async () => {
    const { client } = createMockSupabase({
      responses: { agent_messages: { data: null, error: null } },
    });
    holder.client = client;

    await expect(listRecentMessages(1, 20)).resolves.toEqual([]);
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_messages: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(listRecentMessages(1, 20)).rejects.toThrow("db down");
  });
});
