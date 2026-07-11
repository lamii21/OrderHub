import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { mockedLookup } from "../mocks/dns";

const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

import { crmModule } from "@/lib/automation-modules/crm";
import type { Order } from "@/types/order";

const baseOrder = {
  id: 1,
  shop_id: 7,
  customer_name: "Amina",
  customer_phone: "0600000000",
  product: "T-Shirt",
  quantity: 2,
  price: 199,
  status: "confirmed",
} as Order;

beforeEach(() => {
  getModuleCredentials.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

describe("crmModule.validateConfig", () => {
  it("rejects a missing provider name", () => {
    expect(crmModule.validateConfig!({ endpoint: "https://crm.example.com/hook" })).toBe(
      "CRM requires a provider name."
    );
    expect(crmModule.validateConfig!({ provider: "", endpoint: "https://crm.example.com/hook" })).toMatch(
      /provider name/
    );
  });

  it("rejects a missing/invalid endpoint URL", () => {
    expect(crmModule.validateConfig!({ provider: "hubspot" })).toBe(
      "CRM requires a valid endpoint URL."
    );
    expect(
      crmModule.validateConfig!({ provider: "hubspot", endpoint: "not a url" })
    ).toMatch(/valid endpoint URL/);
  });

  // Regression-style guard for the SSRF fix: a literal private IP is
  // caught synchronously, at config-save time, same rule as Webhook/ERP.
  it("rejects an endpoint pointing at a private/internal address", () => {
    expect(
      crmModule.validateConfig!({ provider: "hubspot", endpoint: "http://169.254.169.254/steal" })
    ).toMatch(/not allowed/i);
  });

  it("accepts a valid provider and endpoint", () => {
    expect(
      crmModule.validateConfig!({ provider: "hubspot", endpoint: "https://crm.example.com/hook" })
    ).toBeNull();
  });
});

describe("crmModule.run", () => {
  it("fails cleanly when the order has no shop", async () => {
    const result = await crmModule.run(
      { ...baseOrder, shop_id: null },
      { provider: "hubspot", endpoint: "https://crm.example.com/hook" },
      {}
    );
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("pushes the order as JSON and works with no credentials configured (apiKey is optional)", async () => {
    getModuleCredentials.mockResolvedValue(null);
    const fetchMock = mockFetchSequence([{ json: async () => ({ record_id: "CRM-1" }) }]);

    const result = await crmModule.run(
      baseOrder,
      { provider: "hubspot", endpoint: "https://crm.example.com/hook" },
      {}
    );

    expect(result).toEqual({
      success: true,
      message: "Order pushed to hubspot.",
      data: { crmRecordId: "CRM-1" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://crm.example.com/hook");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.order_id).toBe(1);
    expect(body.product).toBe("T-Shirt");
  });

  it("omits data entirely when the response has no record_id", async () => {
    getModuleCredentials.mockResolvedValue(null);
    mockFetchSequence([{ json: async () => ({}) }]);

    const result = await crmModule.run(
      baseOrder,
      { provider: "hubspot", endpoint: "https://crm.example.com/hook" },
      {}
    );

    expect(result).toEqual({ success: true, message: "Order pushed to hubspot.", data: undefined });
  });

  it("sends the configured API key as a bearer token when present", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "crm-secret" });
    const fetchMock = mockFetchSequence([{ json: async () => ({}) }]);

    await crmModule.run(
      baseOrder,
      { provider: "salesforce", endpoint: "https://crm.example.com/hook" },
      {}
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer crm-secret");
  });

  it("reports a structured failure on a non-2xx response", async () => {
    getModuleCredentials.mockResolvedValue(null);
    mockFetchSequence([{ ok: false, status: 500 }]);

    const result = await crmModule.run(
      baseOrder,
      { provider: "hubspot", endpoint: "https://crm.example.com/hook" },
      {}
    );

    expect(result).toEqual({ success: false, message: "CRM request failed (HTTP 500)." });
  });

  it("reports a network-error failure without throwing", async () => {
    getModuleCredentials.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await crmModule.run(
      baseOrder,
      { provider: "hubspot", endpoint: "https://crm.example.com/hook" },
      {}
    );

    expect(result).toEqual({ success: false, message: "CRM request failed (network error)." });
  });

  it("reports a timeout distinctly from a generic network error", async () => {
    getModuleCredentials.mockResolvedValue(null);
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await crmModule.run(
      baseOrder,
      { provider: "hubspot", endpoint: "https://crm.example.com/hook" },
      {}
    );

    expect(result).toEqual({ success: false, message: "CRM request timed out." });
  });

  // Regression-style guard for the SSRF fix: a hostname that resolves (via
  // DNS, not just a literal IP) to a private address is caught here even
  // though it already passed validateConfig() at save time.
  it("never calls fetch() when the endpoint resolves to a private address", async () => {
    getModuleCredentials.mockResolvedValue(null);
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await crmModule.run(
      baseOrder,
      { provider: "hubspot", endpoint: "https://internal.example.com/hook" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not allowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
