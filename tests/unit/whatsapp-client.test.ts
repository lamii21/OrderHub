import { describe, it, expect, afterEach, vi } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { sendWhatsAppTextMessage, WhatsAppApiError } from "@/lib/whatsapp-client";

const credentials = { accessToken: "token-1", phoneNumberId: "phone-1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendWhatsAppTextMessage", () => {
  it("sends a text message to the Graph API with the right URL, auth header, and body", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ messages: [{ id: "wamid.abc" }] }) }]);

    await sendWhatsAppTextMessage(credentials, "0600000000", "Hello");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/phone-1/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ messaging_product: "whatsapp", to: "0600000000", type: "text", text: { body: "Hello" } });
  });

  it("returns the message id when the API reports one", async () => {
    mockFetchSequence([{ json: async () => ({ messages: [{ id: "wamid.abc" }] }) }]);
    await expect(sendWhatsAppTextMessage(credentials, "0600000000", "Hello")).resolves.toEqual({
      messageId: "wamid.abc",
    });
  });

  it("returns an empty result, not undefined, when the response has no message id", async () => {
    mockFetchSequence([{ json: async () => ({ messages: [] }) }]);
    await expect(sendWhatsAppTextMessage(credentials, "0600000000", "Hello")).resolves.toEqual({});
  });

  it("throws WhatsAppApiError, carrying the HTTP status, on a non-2xx response", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);

    const error = await sendWhatsAppTextMessage(credentials, "0600000000", "Hello").catch((err) => err);

    expect(error).toBeInstanceOf(WhatsAppApiError);
    expect(error.message).toBe("WhatsApp API request failed (HTTP 401).");
    expect(error.status).toBe(401);
  });

  it("propagates a network error as-is, not wrapped in WhatsAppApiError", async () => {
    const networkError = new Error("ECONNRESET");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    const error = await sendWhatsAppTextMessage(credentials, "0600000000", "Hello").catch((err) => err);

    expect(error).toBe(networkError);
  });

  it("propagates a timeout (AbortError) as-is", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const error = await sendWhatsAppTextMessage(credentials, "0600000000", "Hello").catch((err) => err);

    expect(error.name).toBe("AbortError");
  });
});
