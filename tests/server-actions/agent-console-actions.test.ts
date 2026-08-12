import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));
vi.mock("crypto", () => ({ randomUUID: vi.fn(() => "fixed-uuid") }));

const { resolveConversation, appendMessage, executeConversation, auditLog } = vi.hoisted(() => ({
  resolveConversation: vi.fn(),
  appendMessage: vi.fn(),
  executeConversation: vi.fn(),
  auditLog: vi.fn(),
}));
vi.mock("@/lib/agent/conversation/service", () => ({ resolveConversation, appendMessage }));
vi.mock("@/lib/agent/engine/execute", () => ({ executeConversation }));
vi.mock("@/lib/logger", () => ({ logger: { audit: auditLog } }));

import { startConsoleConversation, sendConsoleMessage } from "@/app/shops/[id]/agent/console/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  resolveConversation.mockReset();
  appendMessage.mockReset();
  executeConversation.mockReset();
  auditLog.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("startConsoleConversation", () => {
  it("throws without creating a conversation when the shop isn't owned by the current user", async () => {
    const { client } = createMockSupabase({ responses: { shops: [{ data: null, error: null }] } });
    holder.client = client;

    await expect(startConsoleConversation(formData({ shop_id: "1" }))).rejects.toThrow(
      /Shop not found/
    );
    expect(resolveConversation).not.toHaveBeenCalled();
  });

  it("starts an anonymous conversation (no customer_id key at all) and redirects with its id", async () => {
    const { client } = createMockSupabase({ responses: { shops: [{ data: { id: 1 }, error: null }] } });
    holder.client = client;
    resolveConversation.mockResolvedValue({ id: 42 });

    await expect(startConsoleConversation(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/agent\/console\?conversation_id=42/
    );

    expect(resolveConversation).toHaveBeenCalledWith({
      shop_id: 1,
      channel: "console",
      external_thread_id: "console-fixed-uuid",
    });
  });

  it("includes customer_id when one is selected", async () => {
    const { client } = createMockSupabase({ responses: { shops: [{ data: { id: 1 }, error: null }] } });
    holder.client = client;
    resolveConversation.mockResolvedValue({ id: 42 });

    await expect(
      startConsoleConversation(formData({ shop_id: "1", customer_id: "7" }))
    ).rejects.toThrow(/REDIRECT:/);

    expect(resolveConversation).toHaveBeenCalledWith({
      shop_id: 1,
      channel: "console",
      external_thread_id: "console-fixed-uuid",
      customer_id: 7,
    });
  });
});

describe("sendConsoleMessage", () => {
  it("throws without appending anything when the conversation isn't owned by the current user", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: [{ data: null, error: null }] },
    });
    holder.client = client;

    await expect(
      sendConsoleMessage(formData({ shop_id: "1", conversation_id: "42", message: "hi" }))
    ).rejects.toThrow(/Conversation not found/);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("redirects without calling appendMessage or executeConversation for a blank message", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: [{ data: { id: 42 }, error: null }] },
    });
    holder.client = client;

    await expect(
      sendConsoleMessage(formData({ shop_id: "1", conversation_id: "42", message: "   " }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/agent\/console\?conversation_id=42$/);

    expect(appendMessage).not.toHaveBeenCalled();
    expect(executeConversation).not.toHaveBeenCalled();
  });

  it("appends the user message, runs the engine, and redirects cleanly on success", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: [{ data: { id: 42 }, error: null }] },
    });
    holder.client = client;
    appendMessage.mockResolvedValue({ conversation: { id: 42 }, message: { id: 1 } });
    executeConversation.mockResolvedValue({ message: { content: "Hi there" } });

    await expect(
      sendConsoleMessage(formData({ shop_id: "1", conversation_id: "42", message: "Where is my order?" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/agent\/console\?conversation_id=42$/);

    expect(appendMessage).toHaveBeenCalledWith({
      conversation_id: 42,
      role: "user",
      content: "Where is my order?",
    });
    expect(executeConversation).toHaveBeenCalledWith({ conversation_id: 42 });
  });

  it("still persists the user message but redirects with an error when the engine throws", async () => {
    const { client } = createMockSupabase({
      responses: { agent_conversations: [{ data: { id: 42 }, error: null }] },
    });
    holder.client = client;
    appendMessage.mockResolvedValue({ conversation: { id: 42 }, message: { id: 1 } });
    executeConversation.mockRejectedValue(new Error("OpenRouter rate limit exceeded"));

    await expect(
      sendConsoleMessage(formData({ shop_id: "1", conversation_id: "42", message: "Where is my order?" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/agent\/console\?conversation_id=42&error=/);

    expect(appendMessage).toHaveBeenCalled();
  });
});
