import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockFetchSequence } from "../../mocks/fetch";
import { whatsappChannelAdapter } from "@/lib/agent/channels/whatsapp";

function messagePayload(overrides: Record<string, unknown> = {}) {
  return {
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "16505551111", phone_number_id: "123456123" },
              contacts: [{ profile: { name: "Salma" }, wa_id: "212600000000" }],
              messages: [
                {
                  from: "212600000000",
                  id: "wamid.abc",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "wach kayn had produit?" },
                  ...overrides,
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function statusPayload() {
  return {
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "16505551111", phone_number_id: "123456123" },
              statuses: [{ id: "wamid.abc", status: "delivered", timestamp: "1700000000", recipient_id: "212600000000" }],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

describe("whatsappChannelAdapter.channel", () => {
  it("matches its own registry key", () => {
    expect(whatsappChannelAdapter.channel).toBe("whatsapp");
  });
});

describe("whatsappChannelAdapter.parseInboundMessage", () => {
  it("parses a real Meta text-message payload into a NormalizedInboundMessage", () => {
    const result = whatsappChannelAdapter.parseInboundMessage(messagePayload());

    expect(result).toEqual({
      external_thread_id: "212600000000",
      content: "wach kayn had produit?",
      customer: { phone: "212600000000", name: "Salma" },
    });
  });

  it("uses null for the customer name when no contact profile is present", () => {
    const payload = messagePayload();
    delete (payload.entry[0].changes[0].value as { contacts?: unknown }).contacts;

    const result = whatsappChannelAdapter.parseInboundMessage(payload);

    expect(result?.customer).toEqual({ phone: "212600000000", name: null });
  });

  it("returns null for a delivery/read status receipt, not a message", () => {
    expect(whatsappChannelAdapter.parseInboundMessage(statusPayload())).toBeNull();
  });

  it("returns null for a non-text message type (e.g. image)", () => {
    const payload = messagePayload({ type: "image", text: undefined, image: { id: "media-id" } });
    expect(whatsappChannelAdapter.parseInboundMessage(payload)).toBeNull();
  });

  it("returns null, never throws, for a completely malformed payload", () => {
    expect(whatsappChannelAdapter.parseInboundMessage(null)).toBeNull();
    expect(whatsappChannelAdapter.parseInboundMessage(undefined)).toBeNull();
    expect(whatsappChannelAdapter.parseInboundMessage("not an object")).toBeNull();
    expect(whatsappChannelAdapter.parseInboundMessage({})).toBeNull();
    expect(whatsappChannelAdapter.parseInboundMessage({ entry: "not an array" })).toBeNull();
  });

  it("returns null when the message has no from field", () => {
    const payload = messagePayload({ from: undefined });
    expect(whatsappChannelAdapter.parseInboundMessage(payload)).toBeNull();
  });
});

describe("whatsappChannelAdapter.sendMessage", () => {
  const credentials = { accessToken: "token-1", phoneNumberId: "phone-1" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a text message via the shared WhatsApp client", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ messages: [{ id: "wamid.abc" }] }) }]);

    await whatsappChannelAdapter.sendMessage("212600000000", "Wah, kayn 3 modèles.", credentials);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/phone-1/messages");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("212600000000");
    expect(body.text.body).toBe("Wah, kayn 3 modèles.");
  });

  it("throws (never returns a {success} result) on invalid credentials", async () => {
    await expect(whatsappChannelAdapter.sendMessage("212600000000", "hi", {})).rejects.toThrow(
      "Invalid WhatsApp credentials"
    );
  });

  it("propagates a WhatsAppApiError from the underlying client as-is", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);

    await expect(whatsappChannelAdapter.sendMessage("212600000000", "hi", credentials)).rejects.toThrow(
      "WhatsApp API request failed (HTTP 401)."
    );
  });
});
