import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { webhookModule } from "@/lib/automation-modules/webhook";
import type { Order } from "@/types/order";

const order = { id: 1, shop_id: 7, shops: { name: "Acme", platform: "Shopify" } } as Order;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("webhookModule.validateConfig", () => {
  it("rejects a non-URL", () => {
    expect(webhookModule.validateConfig!({ url: "not a url" })).toMatch(/valid http/);
  });

  it("rejects an unsupported method", () => {
    expect(webhookModule.validateConfig!({ url: "https://example.com", method: "GET" })).toMatch(
      /method must be one of/
    );
  });

  it("accepts a bare https URL (method/headers optional)", () => {
    expect(webhookModule.validateConfig!({ url: "https://example.com/hook" })).toBeNull();
  });

  it("accepts an explicit allowed method", () => {
    expect(
      webhookModule.validateConfig!({ url: "https://example.com/hook", method: "put" })
    ).toBeNull();
  });
});

describe("webhookModule.run", () => {
  it("POSTs the order (and shop) as JSON by default", async () => {
    const fetchMock = mockFetchSequence([{ status: 200, text: async () => "ok" }]);

    const result = await webhookModule.run(order, { url: "https://example.com/hook" }, {});

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.order.id).toBe(1);
    expect(body.shop.name).toBe("Acme");
  });

  it("uses the configured method and merges in custom headers", async () => {
    const fetchMock = mockFetchSequence([{ status: 200, text: async () => "ok" }]);

    await webhookModule.run(
      order,
      { url: "https://example.com/hook", method: "put", headers: { "X-Api-Key": "secret" } },
      {}
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("secret");
  });

  it("reports success: false on a non-2xx response, with the status/body captured in data", async () => {
    mockFetchSequence([{ ok: false, status: 500, text: async () => "server error" }]);

    const result = await webhookModule.run(order, { url: "https://example.com/hook" }, {});

    expect(result.success).toBe(false);
    expect(result.message).toBe("Webhook responded with HTTP 500.");
    expect(result.data).toEqual({ statusCode: 500, body: "server error" });
  });

  it("reports a network-error failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS failure")));

    const result = await webhookModule.run(order, { url: "https://example.com/hook" }, {});

    expect(result).toEqual({ success: false, message: "Webhook request failed (network error)." });
  });

  it("reports a timeout distinctly from a generic network error", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await webhookModule.run(order, { url: "https://example.com/hook" }, {});

    expect(result).toEqual({ success: false, message: "Webhook request timed out." });
  });
});
