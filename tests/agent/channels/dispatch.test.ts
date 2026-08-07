import { describe, it, expect, vi, beforeEach } from "vitest";

const { getChannelAdapter, getModuleCredentials, createOrUpdateCustomer, resolveConversation, appendMessage, executeConversation } =
  vi.hoisted(() => ({
    getChannelAdapter: vi.fn(),
    getModuleCredentials: vi.fn(),
    createOrUpdateCustomer: vi.fn(),
    resolveConversation: vi.fn(),
    appendMessage: vi.fn(),
    executeConversation: vi.fn(),
  }));

vi.mock("@/lib/agent/channels/registry", () => ({ getChannelAdapter }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));
vi.mock("@/lib/customer", () => ({ createOrUpdateCustomer }));
vi.mock("@/lib/agent/conversation/service", () => ({ resolveConversation, appendMessage }));
vi.mock("@/lib/agent/engine/execute", () => ({ executeConversation }));

import { dispatchInboundMessage } from "@/lib/agent/channels/dispatch";

const normalizedMessage = {
  external_thread_id: "212600000000",
  content: "wach kayn had produit?",
  customer: { phone: "212600000000", name: "Salma" },
};

const credentials = { accessToken: "token-1", phoneNumberId: "phone-1" };

const conversation = {
  id: 1,
  shop_id: 15,
  customer_id: 42,
  channel: "whatsapp",
  external_thread_id: "212600000000",
  status: "open" as const,
  memory: { version: 1 },
  created_at: "2026-08-07T10:00:00.000Z",
  last_message_at: "2026-08-07T10:00:00.000Z",
  resolved_at: null,
  escalated_at: null,
};

const persistedMessage = {
  id: 99,
  conversation_id: 1,
  role: "assistant" as const,
  content: "Wah, kayn 3 modèles.",
  content_type: "text" as const,
  detected_language: null,
  detected_intent: null,
  sentiment_score: null,
  confidence_score: null,
  metadata: {},
  created_at: "2026-08-07T10:00:05.000Z",
};

let parseInboundMessage: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  parseInboundMessage = vi.fn().mockReturnValue(normalizedMessage);
  sendMessage = vi.fn().mockResolvedValue(undefined);
  getChannelAdapter.mockReset().mockReturnValue({ channel: "whatsapp", parseInboundMessage, sendMessage });
  getModuleCredentials.mockReset().mockResolvedValue(credentials);
  createOrUpdateCustomer.mockReset().mockResolvedValue({ id: 42 });
  resolveConversation.mockReset().mockResolvedValue(conversation);
  appendMessage.mockReset().mockResolvedValue({ conversation, message: {} });
  executeConversation.mockReset().mockResolvedValue({ conversation, message: persistedMessage });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("dispatchInboundMessage — happy path", () => {
  it("resolves the customer, the conversation, persists the inbound message, runs the engine, and sends the reply", async () => {
    await dispatchInboundMessage({ shopId: 15, channel: "whatsapp", rawPayload: { fake: "payload" } });

    expect(getChannelAdapter).toHaveBeenCalledWith("whatsapp");
    expect(parseInboundMessage).toHaveBeenCalledWith({ fake: "payload" });
    expect(getModuleCredentials).toHaveBeenCalledWith(15, "whatsapp");

    expect(createOrUpdateCustomer).toHaveBeenCalledWith({ shopId: 15, phone: "212600000000", name: "Salma" });
    expect(resolveConversation).toHaveBeenCalledWith({
      shop_id: 15,
      channel: "whatsapp",
      external_thread_id: "212600000000",
      customer_id: 42,
    });
    expect(appendMessage).toHaveBeenCalledWith({
      conversation_id: 1,
      role: "user",
      content: "wach kayn had produit?",
    });
    expect(executeConversation).toHaveBeenCalledWith({ conversation_id: 1 });
    expect(sendMessage).toHaveBeenCalledWith("212600000000", "Wah, kayn 3 modèles.", credentials);
  });

  it("resolves the conversation without a customer_id when the adapter reports no customer", async () => {
    parseInboundMessage.mockReturnValue({ ...normalizedMessage, customer: null });

    await dispatchInboundMessage({ shopId: 15, channel: "whatsapp", rawPayload: {} });

    expect(createOrUpdateCustomer).not.toHaveBeenCalled();
    expect(resolveConversation).toHaveBeenCalledWith({
      shop_id: 15,
      channel: "whatsapp",
      external_thread_id: "212600000000",
    });
  });
});

describe("dispatchInboundMessage — nothing to do", () => {
  it("does nothing when the adapter reports no message (e.g. a status receipt)", async () => {
    parseInboundMessage.mockReturnValue(null);

    await dispatchInboundMessage({ shopId: 15, channel: "whatsapp", rawPayload: {} });

    expect(getModuleCredentials).not.toHaveBeenCalled();
    expect(resolveConversation).not.toHaveBeenCalled();
    expect(executeConversation).not.toHaveBeenCalled();
  });

  it("does nothing and logs when the channel isn't configured for this shop", async () => {
    getModuleCredentials.mockResolvedValue(null);

    await dispatchInboundMessage({ shopId: 15, channel: "whatsapp", rawPayload: {} });

    expect(resolveConversation).not.toHaveBeenCalled();
    expect(executeConversation).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not configured"));
  });
});

describe("dispatchInboundMessage — failure isolation", () => {
  it("logs and returns, without calling the engine, when persisting the inbound message fails", async () => {
    resolveConversation.mockRejectedValue(new Error("db down"));

    await dispatchInboundMessage({ shopId: 15, channel: "whatsapp", rawPayload: {} });

    expect(executeConversation).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("logs and returns, without sending a reply, when the engine fails", async () => {
    executeConversation.mockRejectedValue(new Error("AI agent is not active for shop 15"));

    await dispatchInboundMessage({ shopId: 15, channel: "whatsapp", rawPayload: {} });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("logs but does not throw when delivering the reply fails", async () => {
    sendMessage.mockRejectedValue(new Error("WhatsApp API request failed (HTTP 401)."));

    await expect(
      dispatchInboundMessage({ shopId: 15, channel: "whatsapp", rawPayload: {} })
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });

  it("lets an unknown-channel error from getChannelAdapter propagate, unlike every other failure", async () => {
    getChannelAdapter.mockImplementation(() => {
      throw new Error('No channel adapter registered for "telegram"');
    });

    await expect(dispatchInboundMessage({ shopId: 15, channel: "telegram", rawPayload: {} })).rejects.toThrow(
      'No channel adapter registered for "telegram"'
    );
  });
});
