import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { webhookModule } from "@/lib/automation-modules/webhook";
import { mockedLookup } from "../mocks/dns";
import type { Order } from "@/types/order";

const order = { id: 1, shop_id: 7, shops: { name: "Acme", platform: "Shopify" } } as Order;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

describe("webhookModule.validateConfig", () => {
  it("rejects a non-URL", () => {
    expect(webhookModule.validateConfig!({ url: "not a url" })).toMatch(/valid http/);
  });

  // Regression test for the SSRF fix: a literal private IP is caught
  // synchronously, at config-save time, before a merchant can even save
  // the step.
  it("rejects a URL pointing at a private/internal address", () => {
    expect(webhookModule.validateConfig!({ url: "http://169.254.169.254/steal" })).toMatch(
      /not allowed/i
    );
  });

  it("rejects an unsupported method", () => {
    expect(webhookModule.validateConfig!({ url: "https://example.com", method: "GET" })).toMatch(
      /method must be one of/
    );
  });

  it("rejects headers that aren't an object", () => {
    expect(
      webhookModule.validateConfig!({ url: "https://example.com", headers: "not-an-object" })
    ).toMatch(/headers must be an object/);
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

  // Regression test for the SSRF fix: a hostname that resolves (via DNS,
  // not just a literal IP) to a private address is caught here even though
  // it already passed validateConfig() at save time — a config saved
  // before this check existed, or a hostname that now resolves
  // differently, is still blocked right before the request would be made.
  it("never calls fetch() when the URL resolves to a private address", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await webhookModule.run(order, { url: "https://internal.example.com/hook" }, {});

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not allowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
