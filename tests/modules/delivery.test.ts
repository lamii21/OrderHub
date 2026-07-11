import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { mockedLookup } from "../mocks/dns";

const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

import { deliveryModule } from "@/lib/automation-modules/delivery";
import type { Order } from "@/types/order";

const baseOrder = {
  id: 1,
  shop_id: 7,
  customer_name: "Amina",
  customer_phone: "0600000000",
  customer_address: "1 Rue X",
  customer_city: "Rabat",
  product: "T-Shirt",
  quantity: 2,
} as Order;

beforeEach(() => {
  getModuleCredentials.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

describe("deliveryModule.validateConfig", () => {
  it("accepts the only registered carrier", () => {
    expect(deliveryModule.validateConfig!({ carrier: "generic-webhook" })).toBeNull();
  });

  it("rejects an unregistered carrier", () => {
    expect(deliveryModule.validateConfig!({ carrier: "dhl" })).toMatch(/valid carrier/);
  });

  it("rejects a missing carrier", () => {
    expect(deliveryModule.validateConfig!({})).not.toBeNull();
  });
});

describe("deliveryModule.run", () => {
  it("fails cleanly when the order has no shop", async () => {
    const result = await deliveryModule.run(
      { ...baseOrder, shop_id: null },
      { carrier: "generic-webhook" },
      {}
    );
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("fails cleanly when the order is missing an address or city", async () => {
    const result = await deliveryModule.run(
      { ...baseOrder, customer_address: null },
      { carrier: "generic-webhook" },
      {}
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/address or city/);
  });

  it("fails cleanly for an unknown carrier even if validateConfig was somehow bypassed", async () => {
    const result = await deliveryModule.run(baseOrder, { carrier: "dhl" }, {});
    expect(result).toEqual({ success: false, message: 'Unknown delivery carrier "dhl".' });
  });

  it("fails cleanly when the shop has no delivery credentials configured", async () => {
    getModuleCredentials.mockResolvedValue(null);
    const result = await deliveryModule.run(baseOrder, { carrier: "generic-webhook" }, {});
    expect(result).toEqual({ success: false, message: "Delivery is not configured for this shop." });
  });

  it("posts the order to the configured webhook and returns tracking data", async () => {
    getModuleCredentials.mockResolvedValue({ webhookUrl: "https://carrier.example.com/ship", apiKey: "key-1" });
    const fetchMock = mockFetchSequence([
      { json: async () => ({ tracking_number: "TRK123", carrier_name: "Acme Carrier" }) },
    ]);

    const result = await deliveryModule.run(baseOrder, { carrier: "generic-webhook" }, {});

    expect(result).toEqual({
      success: true,
      message: "Shipment created.",
      data: { trackingNumber: "TRK123", carrierName: "Acme Carrier", estimatedDelivery: undefined },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://carrier.example.com/ship");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-1");
  });

  it("reports a structured failure on a non-2xx carrier response", async () => {
    getModuleCredentials.mockResolvedValue({ webhookUrl: "https://carrier.example.com/ship" });
    mockFetchSequence([{ ok: false, status: 502 }]);

    const result = await deliveryModule.run(baseOrder, { carrier: "generic-webhook" }, {});

    expect(result).toEqual({ success: false, message: "Delivery request failed (HTTP 502)." });
  });

  it("falls back to the carrier name 'generic-webhook' when the response omits one", async () => {
    getModuleCredentials.mockResolvedValue({ webhookUrl: "https://carrier.example.com/ship" });
    mockFetchSequence([{ json: async () => ({ tracking_number: "TRK1" }) }]);

    const result = await deliveryModule.run(baseOrder, { carrier: "generic-webhook" }, {});

    expect(result.data).toEqual({
      trackingNumber: "TRK1",
      carrierName: "generic-webhook",
      estimatedDelivery: undefined,
    });
  });

  it("reports a network-error failure without throwing", async () => {
    getModuleCredentials.mockResolvedValue({ webhookUrl: "https://carrier.example.com/ship" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await deliveryModule.run(baseOrder, { carrier: "generic-webhook" }, {});

    expect(result).toEqual({ success: false, message: "Delivery request failed (network error)." });
  });

  it("reports a timeout distinctly from a generic network error", async () => {
    getModuleCredentials.mockResolvedValue({ webhookUrl: "https://carrier.example.com/ship" });
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await deliveryModule.run(baseOrder, { carrier: "generic-webhook" }, {});

    expect(result).toEqual({ success: false, message: "Delivery request timed out." });
  });

  // Regression test for the SSRF fix: module_credentials has no Server
  // Action that writes it (rows are provisioned by hand), so there's no
  // config-save moment to validate webhookUrl at — this run-time check is
  // the only enforcement point.
  it("never calls fetch() when the configured webhookUrl points at a private address", async () => {
    getModuleCredentials.mockResolvedValue({ webhookUrl: "http://169.254.169.254/ship" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await deliveryModule.run(baseOrder, { carrier: "generic-webhook" }, {});

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not allowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
