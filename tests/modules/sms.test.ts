import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";

const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

import { smsModule } from "@/lib/automation-modules/sms";
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

describe("smsModule.validateConfig", () => {
  it("rejects a missing template", () => {
    expect(smsModule.validateConfig!({})).toBe("SMS requires a non-empty message template.");
  });

  it("rejects a blank template", () => {
    expect(smsModule.validateConfig!({ template: "   " })).not.toBeNull();
  });

  it("accepts a valid template", () => {
    expect(smsModule.validateConfig!({ template: "Hi {{customer_name}}" })).toBeNull();
  });
});

describe("smsModule.run", () => {
  it("fails cleanly when the order has no shop", async () => {
    const result = await smsModule.run({ ...baseOrder, shop_id: null }, { template: "Hi" }, {});
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("fails cleanly when the order has no phone number", async () => {
    const result = await smsModule.run(
      { ...baseOrder, customer_phone: null },
      { template: "Hi" },
      {}
    );
    expect(result).toEqual({ success: false, message: "Order has no customer phone number." });
  });

  it("fails cleanly when no credentials are configured for the shop", async () => {
    getModuleCredentials.mockResolvedValue(null);

    const result = await smsModule.run(baseOrder, { template: "Hi" }, {});

    expect(result).toEqual({ success: false, message: "SMS is not configured for this shop." });
  });

  it("sends the rendered template via Twilio and returns the message sid", async () => {
    getModuleCredentials.mockResolvedValue({
      accountSid: "AC123",
      authToken: "secret-token",
      fromNumber: "+15550001111",
    });
    const fetchMock = mockFetchSequence([{ json: async () => ({ sid: "SM123" }) }]);

    const result = await smsModule.run(
      baseOrder,
      { template: "Hi {{customer_name}}, order for {{product}} confirmed" },
      {}
    );

    expect(result).toEqual({
      success: true,
      message: "SMS sent.",
      data: { messageSid: "SM123" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("AC123:secret-token").toString("base64")}`
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe("0600000000");
    expect(body.get("From")).toBe("+15550001111");
    expect(body.get("Body")).toBe("Hi Amina, order for T-Shirt confirmed");
  });

  it("omits data entirely when the Twilio response has no message sid", async () => {
    getModuleCredentials.mockResolvedValue({
      accountSid: "AC123",
      authToken: "secret-token",
      fromNumber: "+15550001111",
    });
    mockFetchSequence([{ json: async () => ({}) }]);

    const result = await smsModule.run(baseOrder, { template: "Hi" }, {});

    expect(result).toEqual({ success: true, message: "SMS sent.", data: undefined });
  });

  it("reports a structured failure on a non-2xx API response", async () => {
    getModuleCredentials.mockResolvedValue({
      accountSid: "AC123",
      authToken: "secret-token",
      fromNumber: "+15550001111",
    });
    mockFetchSequence([{ ok: false, status: 401 }]);

    const result = await smsModule.run(baseOrder, { template: "Hi" }, {});

    expect(result).toEqual({ success: false, message: "SMS request failed (HTTP 401)." });
  });

  it("reports a structured failure on a network error (never throws)", async () => {
    getModuleCredentials.mockResolvedValue({
      accountSid: "AC123",
      authToken: "secret-token",
      fromNumber: "+15550001111",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await smsModule.run(baseOrder, { template: "Hi" }, {});

    expect(result).toEqual({ success: false, message: "SMS request failed (network error)." });
  });

  it("reports a timeout distinctly from a generic network error", async () => {
    getModuleCredentials.mockResolvedValue({
      accountSid: "AC123",
      authToken: "secret-token",
      fromNumber: "+15550001111",
    });
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await smsModule.run(baseOrder, { template: "Hi" }, {});

    expect(result).toEqual({ success: false, message: "SMS request timed out." });
  });
});
