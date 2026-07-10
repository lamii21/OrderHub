import { describe, it, expect, afterEach, vi } from "vitest";
import { youcanConnector } from "@/lib/platforms/youcan";
import { mockFetchSequence } from "../mocks/fetch";

const credentials = { storeUrl: "https://acme.youcan.shop", apiKey: "yc_test" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("youcanConnector.testConnection", () => {
  it("returns true on a 2xx response", async () => {
    mockFetchSequence([{ ok: true }]);
    await expect(youcanConnector.testConnection(credentials)).resolves.toBe(true);
  });

  it("returns false on failure", async () => {
    mockFetchSequence([{ ok: false, status: 403 }]);
    await expect(youcanConnector.testConnection(credentials)).resolves.toBe(false);
  });
});

describe("youcanConnector.fetchProducts", () => {
  it("normalizes YouCan's product shape", async () => {
    mockFetchSequence([
      {
        json: async () => [
          { id: "abc", title: "Hoodie", sku: "H-1", description: "Warm", price: 45, quantity: 7 },
        ],
      },
    ]);

    const products = await youcanConnector.fetchProducts(credentials);

    expect(products).toEqual([
      {
        platformProductId: "abc",
        name: "Hoodie",
        sku: "H-1",
        description: "Warm",
        price: 45,
        stockQuantity: 7,
      },
    ]);
  });

  it("paginates until a page shorter than the page size is returned", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      title: `Item ${i}`,
      sku: null,
      description: null,
      price: 10,
      quantity: 1,
    }));
    const fetchMock = mockFetchSequence([
      { json: async () => fullPage },
      { json: async () => [{ id: 100, title: "Last", sku: null, description: null, price: 5, quantity: 1 }] },
    ]);

    const products = await youcanConnector.fetchProducts(credentials);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(products).toHaveLength(101);
  });

  it("throws a descriptive error on a non-ok response", async () => {
    mockFetchSequence([{ ok: false, status: 500 }]);
    await expect(youcanConnector.fetchProducts(credentials)).rejects.toThrow("YouCan API error: 500");
  });
});

describe("youcanConnector.fetchOrders", () => {
  it("normalizes an order's customer/address/item fields", async () => {
    mockFetchSequence([
      {
        json: async () => [
          {
            id: 1,
            created_at: "2026-01-05T00:00:00Z",
            customer: { full_name: "Sara L.", phone: "0633333333" },
            address: { city: "Fes", address: "3 Rue Z" },
            items: [{ title: "Scarf", quantity: 1, price: 12 }],
          },
        ],
      },
    ]);

    const orders = await youcanConnector.fetchOrders(credentials, null);

    expect(orders).toEqual([
      {
        createdAt: "2026-01-05T00:00:00Z",
        lines: [
          {
            customerName: "Sara L.",
            customerPhone: "0633333333",
            customerCity: "Fes",
            customerAddress: "3 Rue Z",
            product: "Scarf",
            quantity: 1,
            price: 12,
          },
        ],
      },
    ]);
  });

  it("handles a missing customer/address gracefully", async () => {
    mockFetchSequence([
      {
        json: async () => [
          {
            id: 2,
            created_at: "2026-01-05T00:00:00Z",
            customer: null,
            address: null,
            items: [{ title: "Scarf", quantity: 1, price: 12 }],
          },
        ],
      },
    ]);

    const orders = await youcanConnector.fetchOrders(credentials, null);
    expect(orders[0].lines[0].customerName).toBe("");
    expect(orders[0].lines[0].customerCity).toBe("");
  });
});
