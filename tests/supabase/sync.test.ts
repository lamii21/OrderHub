import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const { getConnector, appendOrderRows, recordSyncHistory } = vi.hoisted(() => ({
  getConnector: vi.fn(),
  appendOrderRows: vi.fn(),
  recordSyncHistory: vi.fn(),
}));

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));
vi.mock("@/lib/platforms", () => ({ getConnector }));
vi.mock("@/lib/google-sheets", () => ({ appendOrderRows }));
vi.mock("@/lib/sync-history", () => ({ recordSyncHistory }));

import { syncShopProducts, syncShopOrders, runSyncForShops, toPlatformCredentials } from "@/lib/sync";
import type { SyncableShop } from "@/lib/sync";

const baseShop: SyncableShop = {
  id: 1,
  platform: "Shopify",
  sheet_id: "sheet-abc",
  store_url: "https://acme.myshopify.com",
  api_key: "key-1",
  api_secret: null,
  last_synced_at: null,
  sync_products_enabled: true,
  sync_orders_enabled: true,
};

beforeEach(() => {
  getConnector.mockReset();
  appendOrderRows.mockReset();
  recordSyncHistory.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("toPlatformCredentials", () => {
  it("maps store_url/api_key and omits apiSecret when null", () => {
    expect(toPlatformCredentials(baseShop)).toEqual({
      storeUrl: "https://acme.myshopify.com",
      apiKey: "key-1",
    });
  });

  it("includes apiSecret when present (WooCommerce)", () => {
    expect(toPlatformCredentials({ ...baseShop, api_secret: "secret-1" })).toEqual({
      storeUrl: "https://acme.myshopify.com",
      apiKey: "key-1",
      apiSecret: "secret-1",
    });
  });
});

describe("syncShopProducts", () => {
  it("upserts normalized products and records a success", async () => {
    getConnector.mockReturnValue({
      fetchProducts: vi.fn().mockResolvedValue([
        { platformProductId: "1", name: "Mug", sku: null, description: null, price: 10, stockQuantity: 5 },
      ]),
    });
    const { client, builders } = createMockSupabase({
      responses: { products: { data: null, error: null }, shops: { data: null, error: null } },
    });
    holder.client = client;

    const result = await syncShopProducts(baseShop);

    expect(result).toEqual({ success: true, count: 1 });
    expect(builders.products[0].upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ shop_id: 1, platform_product_id: "1", name: "Mug" })],
      { onConflict: "shop_id,platform_product_id" }
    );
    expect(recordSyncHistory).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: 1, type: "products", status: "success", importedCount: 1 })
    );
    // markAttempted always stamps last_sync_attempt_at, success or failure.
    expect(builders.shops[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ last_sync_attempt_at: expect.any(String) })
    );
  });

  it("skips the upsert entirely when there are no products (never sends an empty array)", async () => {
    getConnector.mockReturnValue({ fetchProducts: vi.fn().mockResolvedValue([]) });
    const { client, builders } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const result = await syncShopProducts(baseShop);

    expect(result).toEqual({ success: true, count: 0 });
    expect(builders.products).toBeUndefined();
  });

  it("records a failure with a safe fixed message when the connector throws", async () => {
    getConnector.mockReturnValue({
      fetchProducts: vi.fn().mockRejectedValue(new Error("401 Unauthorized: token abc123")),
    });
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const result = await syncShopProducts(baseShop);

    expect(result).toEqual({ success: false, count: 0 });
    const call = recordSyncHistory.mock.calls[0][0];
    expect(call.status).toBe("failed");
    expect(call.message).not.toContain("abc123");
  });

  it("still marks the shop as attempted even when the sync fails", async () => {
    getConnector.mockReturnValue({ fetchProducts: vi.fn().mockRejectedValue(new Error("boom")) });
    const { client, builders } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await syncShopProducts(baseShop);

    expect(builders.shops[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ last_sync_attempt_at: expect.any(String) })
    );
  });
});

describe("syncShopOrders", () => {
  it("appends normalized order lines to the shop's sheet and advances the sync cursor", async () => {
    getConnector.mockReturnValue({
      fetchOrders: vi.fn().mockResolvedValue([
        {
          createdAt: "2026-01-01T00:00:00.000Z",
          lines: [
            {
              customerName: "Amina",
              customerPhone: "0600000000",
              customerCity: "Rabat",
              customerAddress: "1 Rue X",
              product: "T-Shirt",
              quantity: 1,
              price: 19.99,
            },
          ],
        },
      ]),
    });
    const { client, builders } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const result = await syncShopOrders(baseShop);

    expect(result).toEqual({ success: true, count: 1 });
    expect(appendOrderRows).toHaveBeenCalledWith("sheet-abc", [
      ["Amina", "0600000000", "Rabat", "1 Rue X", "T-Shirt", 1, 19.99],
    ]);
    // Cursor is the newest createdAt + 1 second, not wall-clock "now".
    expect(builders.shops[0].update).toHaveBeenCalledWith({
      last_synced_at: "2026-01-01T00:00:01.000Z",
    });
  });

  it("never appends to the sheet or advances the cursor when there are no orders", async () => {
    getConnector.mockReturnValue({ fetchOrders: vi.fn().mockResolvedValue([]) });
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const result = await syncShopOrders(baseShop);

    expect(result).toEqual({ success: true, count: 0 });
    expect(appendOrderRows).not.toHaveBeenCalled();
  });

  it("skips the sheet append when the shop has no sheet_id, but still succeeds", async () => {
    getConnector.mockReturnValue({
      fetchOrders: vi.fn().mockResolvedValue([
        {
          createdAt: "2026-01-01T00:00:00.000Z",
          lines: [{ customerName: "A", customerPhone: "", customerCity: "", customerAddress: "", product: "P", quantity: 1, price: 1 }],
        },
      ]),
    });
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const result = await syncShopOrders({ ...baseShop, sheet_id: null });

    expect(result).toEqual({ success: true, count: 1 });
    expect(appendOrderRows).not.toHaveBeenCalled();
  });

  it("records a failure with a safe fixed message when the connector throws", async () => {
    getConnector.mockReturnValue({ fetchOrders: vi.fn().mockRejectedValue(new Error("secret leak")) });
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const result = await syncShopOrders(baseShop);

    expect(result).toEqual({ success: false, count: 0 });
    const call = recordSyncHistory.mock.calls[0][0];
    expect(call.message).not.toContain("secret leak");
  });
});

describe("runSyncForShops", () => {
  it("syncs every shop and aggregates each one's product/order counts", async () => {
    getConnector.mockReturnValue({
      fetchProducts: vi.fn().mockResolvedValue([]),
      fetchOrders: vi.fn().mockResolvedValue([]),
    });
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const results = await runSyncForShops([baseShop, { ...baseShop, id: 2 }]);

    expect(results.map((r) => r.shopId).sort()).toEqual([1, 2]);
  });

  it("respects sync_products_enabled/sync_orders_enabled independently", async () => {
    const fetchProducts = vi.fn().mockResolvedValue([]);
    const fetchOrders = vi.fn().mockResolvedValue([]);
    getConnector.mockReturnValue({ fetchProducts, fetchOrders });
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await runSyncForShops([{ ...baseShop, sync_products_enabled: false, sync_orders_enabled: true }]);

    expect(fetchProducts).not.toHaveBeenCalled();
    expect(fetchOrders).toHaveBeenCalledTimes(1);
  });

  it("continues past a shop whose sync throws unexpectedly, and still returns results for the rest", async () => {
    let call = 0;
    getConnector.mockImplementation(() => ({
      fetchProducts: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) throw new Error("totally unexpected");
        return Promise.resolve([]);
      }),
      fetchOrders: vi.fn().mockResolvedValue([]),
    }));
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const results = await runSyncForShops([
      { ...baseShop, id: 1 },
      { ...baseShop, id: 2 },
    ]);

    // Shop 1's unexpected throw (outside syncShopProducts' own try/catch)
    // doesn't stop shop 2 from being processed and reported.
    expect(results.some((r) => r.shopId === 2)).toBe(true);
  });

  // Regression test for the Critical cron-timeout fix: this loop used to be
  // fully sequential. It's now bounded concurrency — this proves at most
  // SYNC_CONCURRENCY (10) shops are ever mid-sync at the same time, not
  // unlimited-parallel and not one-at-a-time.
  it("processes shops with bounded concurrency (never more than 10 in flight at once)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    getConnector.mockReturnValue({
      fetchProducts: vi.fn().mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return [];
      }),
      fetchOrders: vi.fn().mockResolvedValue([]),
    });
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    const manyShops = Array.from({ length: 25 }, (_, i) => ({ ...baseShop, id: i + 1 }));
    const results = await runSyncForShops(manyShops);

    expect(results).toHaveLength(25);
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(maxInFlight).toBeGreaterThan(1); // proves it's not sequential either
  });
});
