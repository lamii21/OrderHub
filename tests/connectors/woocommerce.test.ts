import { describe, it, expect, afterEach, vi } from "vitest";
import { woocommerceConnector } from "@/lib/platforms/woocommerce";
import { mockFetchSequence } from "../mocks/fetch";
import { mockedLookup } from "../mocks/dns";

const credentials = {
  storeUrl: "https://acme.example.com",
  apiKey: "ck_test",
  apiSecret: "cs_test",
};

afterEach(() => {
  vi.unstubAllGlobals();
  mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

// Regression test for the SSRF fix — see tests/connectors/shopify.test.ts's
// equivalent block for the full reasoning.
describe("woocommerceConnector — SSRF guard", () => {
  it("never calls fetch() for a store_url that is a literal private IP", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      woocommerceConnector.testConnection({
        storeUrl: "192.168.1.1",
        apiKey: "ck_test",
        apiSecret: "cs_test",
      })
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("woocommerceConnector.testConnection", () => {
  it("returns true on a 2xx response and sends the consumer key/secret as query params", async () => {
    const fetchMock = mockFetchSequence([{ ok: true }]);
    await expect(woocommerceConnector.testConnection(credentials)).resolves.toBe(true);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("consumer_key=ck_test");
    expect(url).toContain("consumer_secret=cs_test");
  });

  it("returns false on a non-2xx response", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);
    await expect(woocommerceConnector.testConnection(credentials)).resolves.toBe(false);
  });
});

describe("woocommerceConnector.fetchProducts", () => {
  it("normalizes WooCommerce's product shape, stripping HTML from the description", async () => {
    mockFetchSequence([
      {
        json: async () => [
          {
            id: 5,
            name: "Mug",
            sku: "MUG-1",
            description: "<p>Ceramic mug</p>",
            price: "9.50",
            stock_quantity: 40,
          },
        ],
      },
    ]);

    const products = await woocommerceConnector.fetchProducts(credentials);

    expect(products).toEqual([
      {
        platformProductId: "5",
        name: "Mug",
        sku: "MUG-1",
        description: "Ceramic mug",
        price: 9.5,
        stockQuantity: 40,
      },
    ]);
  });

  it("throws a descriptive error on a non-ok response", async () => {
    mockFetchSequence([{ ok: false, status: 500 }]);
    await expect(woocommerceConnector.fetchProducts(credentials)).rejects.toThrow(
      "WooCommerce API error: 500"
    );
  });

  it("falls back to null for a missing sku/description/price, rather than an empty string", async () => {
    mockFetchSequence([
      { json: async () => [{ id: 6, name: "Plain", sku: "", description: null, price: "", stock_quantity: null }] },
    ]);

    const products = await woocommerceConnector.fetchProducts(credentials);

    expect(products[0].sku).toBeNull();
    expect(products[0].description).toBeNull();
    expect(products[0].price).toBeNull();
  });

  it("follows the Link header's rel=\"next\" URL across pages until it's absent", async () => {
    const fetchMock = mockFetchSequence([
      {
        json: async () => [{ id: 1, name: "A", sku: null, description: null, price: "1", stock_quantity: 1 }],
        headers: { link: '<https://acme.example.com/wp-json/wc/v3/products?page=2>; rel="next"' },
      },
      {
        json: async () => [{ id: 2, name: "B", sku: null, description: null, price: "2", stock_quantity: 2 }],
      },
    ]);

    const products = await woocommerceConnector.fetchProducts(credentials);

    expect(products).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://acme.example.com/wp-json/wc/v3/products?page=2");
  });

  it("reports a timed-out request distinctly, not a generic network error", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(woocommerceConnector.fetchProducts(credentials)).rejects.toThrow(
      "WooCommerce request timed out after 15s"
    );
  });
});

describe("woocommerceConnector.fetchOrders", () => {
  it("normalizes billing/line-item fields and uses date_created_gmt as createdAt", async () => {
    mockFetchSequence([
      {
        json: async () => [
          {
            id: 8,
            date_created_gmt: "2026-02-01T10:00:00",
            billing: {
              first_name: "Youssef",
              last_name: "K.",
              phone: "0622222222",
              address_1: "12 Avenue Y",
              city: "Casablanca",
            },
            line_items: [{ name: "Cap", quantity: 3, price: "15.00" }],
          },
        ],
      },
    ]);

    const orders = await woocommerceConnector.fetchOrders(credentials, null);

    expect(orders).toEqual([
      {
        createdAt: "2026-02-01T10:00:00",
        lines: [
          {
            customerName: "Youssef K.",
            customerPhone: "0622222222",
            customerCity: "Casablanca",
            customerAddress: "12 Avenue Y",
            product: "Cap",
            quantity: 3,
            price: 15,
          },
        ],
      },
    ]);
  });

  it("passes since as 'after' when provided", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => [] }]);
    await woocommerceConnector.fetchOrders(credentials, "2026-01-01T00:00:00.000Z");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("after=2026-01-01");
  });
});
