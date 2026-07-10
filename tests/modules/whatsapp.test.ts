import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";

const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

import { whatsappModule } from "@/lib/automation-modules/whatsapp";
import type { Order } from "@/types/order";

const baseOrder = {
  id: 1,
  shop_id: 7,
  customer_name: "Amina",
  customer_phone: "0600000000",
  product: "T-Shirt",
} as Order;

beforeEach(() => {
  getModuleCredentials.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whatsappModule.validateConfig", () => {
  it("rejects a missing template", () => {
    expect(whatsappModule.validateConfig!({})).toBe("WhatsApp requires a non-empty message template.");
  });

  it("rejects a blank template", () => {
    expect(whatsappModule.validateConfig!({ template: "   " })).not.toBeNull();
  });

  it("accepts a valid template", () => {
    expect(whatsappModule.validateConfig!({ template: "Hi {{customer_name}}" })).toBeNull();
  });
});

describe("whatsappModule.run", () => {
  it("fails cleanly when the order has no shop", async () => {
    const result = await whatsappModule.run({ ...baseOrder, shop_id: null }, { template: "Hi" }, {});
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("fails cleanly when the order has no phone number", async () => {
    const result = await whatsappModule.run(
      { ...baseOrder, customer_phone: null },
      { template: "Hi" },
      {}
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/phone/i);
  });

  it("fails cleanly when no credentials are configured for the shop", async () => {
    getModuleCredentials.mockResolvedValue(null);

    const result = await whatsappModule.run(baseOrder, { template: "Hi" }, {});

    expect(result).toEqual({ success: false, message: "WhatsApp is not configured for this shop." });
  });

  it("sends the rendered template to the WhatsApp Cloud API and returns the message id", async () => {
    getModuleCredentials.mockResolvedValue({ accessToken: "token-1", phoneNumberId: "phone-1" });
    const fetchMock = mockFetchSequence([{ json: async () => ({ messages: [{ id: "wamid.abc" }] }) }]);

    const result = await whatsappModule.run(
      baseOrder,
      { template: "Hi {{customer_name}}, order for {{product}} confirmed" },
      {}
    );

    expect(result).toEqual({
      success: true,
      message: "WhatsApp message sent.",
      data: { messageId: "wamid.abc" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/phone-1/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("0600000000");
    expect(body.text.body).toBe("Hi Amina, order for T-Shirt confirmed");
  });

  it("reports a structured failure on a non-2xx API response", async () => {
    getModuleCredentials.mockResolvedValue({ accessToken: "token-1", phoneNumberId: "phone-1" });
    mockFetchSequence([{ ok: false, status: 401 }]);

    const result = await whatsappModule.run(baseOrder, { template: "Hi" }, {});

    expect(result).toEqual({
      success: false,
      message: "WhatsApp API request failed (HTTP 401).",
    });
  });

  it("reports a structured failure on a network error (never throws)", async () => {
    getModuleCredentials.mockResolvedValue({ accessToken: "token-1", phoneNumberId: "phone-1" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await whatsappModule.run(baseOrder, { template: "Hi" }, {});

    expect(result.success).toBe(false);
    expect(result.message).toBe("WhatsApp API request failed (network error).");
  });
});
