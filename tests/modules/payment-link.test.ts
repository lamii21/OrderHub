import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { createMockSupabase } from "../mocks/supabase";

const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { paymentLinkModule } from "@/lib/automation-modules/payment-link";
import type { Order } from "@/types/order";

const baseOrder = {
  id: 1,
  shop_id: 7,
  product: "T-Shirt",
  quantity: 2,
  price: 19.99,
} as Order;

beforeEach(() => {
  getModuleCredentials.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("paymentLinkModule.validateConfig", () => {
  it("accepts no config at all", () => {
    expect(paymentLinkModule.validateConfig!({})).toBeNull();
  });

  it("accepts a valid description", () => {
    expect(paymentLinkModule.validateConfig!({ description: "Custom order" })).toBeNull();
  });

  it("rejects an overly long description", () => {
    expect(paymentLinkModule.validateConfig!({ description: "x".repeat(501) })).toMatch(/description/);
  });
});

describe("paymentLinkModule.run", () => {
  it("fails cleanly when the order has no shop", async () => {
    const result = await paymentLinkModule.run({ ...baseOrder, shop_id: null }, {}, {});
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("fails cleanly when price or quantity is missing", async () => {
    const result = await paymentLinkModule.run({ ...baseOrder, price: null }, {}, {});
    expect(result).toEqual({ success: false, message: "Order is missing a price or quantity." });
  });

  it("fails cleanly when Stripe isn't configured for the shop", async () => {
    getModuleCredentials.mockResolvedValue(null);
    const result = await paymentLinkModule.run(baseOrder, {}, {});
    expect(result).toEqual({ success: false, message: "Payment Link is not configured for this shop." });
  });

  it("creates a payment link with the order's amount in the smallest currency unit", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk_test_123" });
    const { client } = createMockSupabase({ responses: { shops: { data: { currency: "USD" }, error: null } } });
    holder.client = client;
    const fetchMock = mockFetchSequence([
      { json: async () => ({ id: "plink_123", url: "https://buy.stripe.com/test_123" }) },
    ]);

    const result = await paymentLinkModule.run(baseOrder, {}, {});

    expect(result).toEqual({
      success: true,
      message: "Payment link created.",
      data: { paymentLinkUrl: "https://buy.stripe.com/test_123", paymentLinkId: "plink_123" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/payment_links");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_123");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("1999");
    expect(body.get("line_items[0][quantity]")).toBe("2");
    expect(body.get("line_items[0][price_data][product_data][name]")).toBe("T-Shirt");
  });

  it("uses the configured description over the product name when provided", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk_test_123" });
    const { client } = createMockSupabase({ responses: { shops: { data: { currency: "USD" }, error: null } } });
    holder.client = client;
    const fetchMock = mockFetchSequence([{ json: async () => ({ id: "p", url: "https://buy.stripe.com/x" }) }]);

    await paymentLinkModule.run(baseOrder, { description: "Custom order" }, {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("line_items[0][price_data][product_data][name]")).toBe("Custom order");
  });

  it("defaults to USD (lowercased) when the shop's currency can't be found", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk_test_123" });
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;
    const fetchMock = mockFetchSequence([{ json: async () => ({ id: "p", url: "https://buy.stripe.com/x" }) }]);

    await paymentLinkModule.run(baseOrder, {}, {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
  });

  it("reports a structured failure on a non-2xx Stripe response", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk_test_123" });
    const { client } = createMockSupabase({ responses: { shops: { data: { currency: "USD" }, error: null } } });
    holder.client = client;
    mockFetchSequence([{ ok: false, status: 401 }]);

    const result = await paymentLinkModule.run(baseOrder, {}, {});

    expect(result).toEqual({ success: false, message: "Stripe request failed (HTTP 401)." });
  });

  it("reports a structured failure when Stripe returns no url", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk_test_123" });
    const { client } = createMockSupabase({ responses: { shops: { data: { currency: "USD" }, error: null } } });
    holder.client = client;
    mockFetchSequence([{ json: async () => ({ id: "plink_123" }) }]);

    const result = await paymentLinkModule.run(baseOrder, {}, {});

    expect(result).toEqual({ success: false, message: "Stripe did not return a payment link URL." });
  });

  it("reports a structured failure on a network error (never throws)", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk_test_123" });
    const { client } = createMockSupabase({ responses: { shops: { data: { currency: "USD" }, error: null } } });
    holder.client = client;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await paymentLinkModule.run(baseOrder, {}, {});

    expect(result.success).toBe(false);
    expect(result.message).toBe("Stripe request failed (network error).");
  });
});
