import { describe, it, expect, afterEach, vi } from "vitest";
import { shopifyConnector } from "@/lib/platforms/shopify";
import { mockFetchSequence } from "../mocks/fetch";

const credentials = { storeUrl: "https://acme.myshopify.com", apiKey: "shpat_test" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shopifyConnector.testConnection", () => {
  it("returns true on a 2xx response", async () => {
    mockFetchSequence([{ ok: true, status: 200 }]);
    await expect(shopifyConnector.testConnection(credentials)).resolves.toBe(true);
  });

  it("returns false on a non-2xx response (never throws)", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);
    await expect(shopifyConnector.testConnection(credentials)).resolves.toBe(false);
  });

  it("returns false when the request itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    await expect(shopifyConnector.testConnection(credentials)).resolves.toBe(false);
  });
});

describe("shopifyConnector.fetchProducts", () => {
  it("normalizes Shopify's product shape into NormalizedProduct", async () => {
    mockFetchSequence([
      {
        json: async () => ({
          products: [
            {
              id: 111,
              title: "T-Shirt",
              body_html: "<p>Soft cotton</p>",
              variants: [{ sku: "TS-1", price: "19.99", inventory_quantity: 12 }],
            },
          ],
        }),
      },
    ]);

    const products = await shopifyConnector.fetchProducts(credentials);

    expect(products).toEqual([
      {
        platformProductId: "111",
        name: "T-Shirt",
        sku: "TS-1",
        description: "Soft cotton",
        price: 19.99,
        stockQuantity: 12,
      },
    ]);
  });

  it("follows Link: rel=next pagination across multiple pages", async () => {
    const fetchMock = mockFetchSequence([
      {
        headers: { link: '<https://acme.myshopify.com/admin/api/2024-01/products.json?page=2>; rel="next"' },
        json: async () => ({ products: [{ id: 1, title: "A", body_html: null, variants: [] }] }),
      },
      {
        json: async () => ({ products: [{ id: 2, title: "B", body_html: null, variants: [] }] }),
      },
    ]);

    const products = await shopifyConnector.fetchProducts(credentials);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(products.map((p) => p.platformProductId)).toEqual(["1", "2"]);
  });

  it("throws a descriptive error on a non-ok response", async () => {
    mockFetchSequence([{ ok: false, status: 500 }]);
    await expect(shopifyConnector.fetchProducts(credentials)).rejects.toThrow(
      "Shopify API error: 500"
    );
  });

  it("retries once on HTTP 429, honoring Retry-After, then succeeds", async () => {
    vi.useFakeTimers();
    mockFetchSequence([
      { status: 429, headers: { "retry-after": "1" } },
      { json: async () => ({ products: [] }) },
    ]);

    const promise = shopifyConnector.fetchProducts(credentials);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toEqual([]);
  });
});

describe("shopifyConnector.fetchOrders", () => {
  it("normalizes an order's customer/shipping/line-item fields", async () => {
    mockFetchSequence([
      {
        json: async () => ({
          orders: [
            {
              id: 9,
              created_at: "2026-01-01T00:00:00Z",
              customer: { first_name: "Amina", last_name: "B.", phone: "0600000000" },
              shipping_address: { name: "Amina B.", address1: "1 Rue X", city: "Rabat", phone: null },
              line_items: [{ title: "T-Shirt", quantity: 2, price: "19.99" }],
            },
          ],
        }),
      },
    ]);

    const orders = await shopifyConnector.fetchOrders(credentials, null);

    expect(orders).toEqual([
      {
        createdAt: "2026-01-01T00:00:00Z",
        lines: [
          {
            customerName: "Amina B.",
            customerPhone: "0600000000",
            customerCity: "Rabat",
            customerAddress: "1 Rue X",
            product: "T-Shirt",
            quantity: 2,
            price: 19.99,
          },
        ],
      },
    ]);
  });

  it("falls back to the shipping address name when there is no customer record", async () => {
    mockFetchSequence([
      {
        json: async () => ({
          orders: [
            {
              id: 10,
              created_at: "2026-01-01T00:00:00Z",
              customer: null,
              shipping_address: { name: "Guest Buyer", address1: null, city: null, phone: "0611111111" },
              line_items: [{ title: "Mug", quantity: 1, price: "9.5" }],
            },
          ],
        }),
      },
    ]);

    const orders = await shopifyConnector.fetchOrders(credentials, null);

    expect(orders[0].lines[0].customerName).toBe("Guest Buyer");
    expect(orders[0].lines[0].customerPhone).toBe("0611111111");
  });

  it("passes since as created_at_min when provided", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ orders: [] }) }]);

    await shopifyConnector.fetchOrders(credentials, "2026-01-01T00:00:00.000Z");

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain("created_at_min=2026-01-01");
  });
});
