import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

// lib/shop.ts imports the module-scope service-role client directly (it's
// a system-context write, same as everywhere else in lib/), so it can't
// take a client as a parameter the way lib/orders.ts does — the module
// itself has to be mocked. `holder` is mutable so each test can swap in
// its own configured mock without re-mocking the module.
const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { createOrUpdateShop } from "@/lib/shop";

describe("createOrUpdateShop", () => {
  it("upserts on sheet_id and returns the row id", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: { id: 42 }, error: null } },
    });
    holder.client = client;

    const result = await createOrUpdateShop({
      name: "Acme",
      platform: "Shopify",
      sheetId: "sheet-123",
      sheetName: "Acme Sheet",
    });

    expect(result).toEqual({ id: 42 });
    expect(builders.shops[0].upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme",
        platform: "Shopify",
        sheet_id: "sheet-123",
        sheet_name: "Acme Sheet",
      }),
      { onConflict: "sheet_id" }
    );
  });

  it("omits userId/storeUrl/apiKey/apiSecret entirely when not provided (never overwrites with undefined)", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: { id: 1 }, error: null } },
    });
    holder.client = client;

    await createOrUpdateShop({
      name: "Acme",
      platform: "Shopify",
      sheetId: "sheet-123",
      sheetName: null,
    });

    const payload = builders.shops[0].upsert.mock.calls[0][0];
    expect(payload).not.toHaveProperty("user_id");
    expect(payload).not.toHaveProperty("store_url");
    expect(payload).not.toHaveProperty("api_key");
    expect(payload).not.toHaveProperty("api_secret");
  });

  it("includes storeUrl/apiKey when provided (the connect flow)", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: { id: 5 }, error: null } },
    });
    holder.client = client;

    await createOrUpdateShop({
      name: "Acme",
      platform: "WooCommerce",
      sheetId: "sheet-9",
      sheetName: "Sheet",
      userId: "user-1",
      storeUrl: "https://acme.example.com",
      apiKey: "ck_123",
      apiSecret: "cs_456",
    });

    expect(builders.shops[0].upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        store_url: "https://acme.example.com",
        api_key: "ck_123",
        api_secret: "cs_456",
      }),
      { onConflict: "sheet_id" }
    );
  });

  it("throws when the upsert fails", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: null, error: { message: "duplicate key" } } },
    });
    holder.client = client;

    await expect(
      createOrUpdateShop({ name: "Acme", platform: "Shopify", sheetId: "s1", sheetName: null })
    ).rejects.toThrow("duplicate key");
  });

  it("updates the existing row by (user_id, store_url) instead of inserting a duplicate when sheetId is null (connectShop, no Google account connected yet)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        shops: [
          { data: { id: 8 }, error: null }, // SELECT finds the existing row
          { data: { id: 8 }, error: null }, // UPDATE returns it
        ],
      },
    });
    holder.client = client;

    const result = await createOrUpdateShop({
      name: "AYLA",
      platform: "Shopify",
      sheetId: null,
      sheetName: null,
      userId: "user-1",
      storeUrl: "https://ayla.myshopify.com",
      apiKey: "new-key",
    });

    expect(result).toEqual({ id: 8 });
    // First call: the lookup SELECT.
    expect(builders.shops[0].eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(builders.shops[0].eq).toHaveBeenCalledWith("platform", "Shopify");
    expect(builders.shops[0].eq).toHaveBeenCalledWith("store_url", "https://ayla.myshopify.com");
    // Second call: the UPDATE, never an insert/upsert.
    expect(builders.shops[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AYLA", platform: "Shopify", api_key: "new-key" })
    );
    expect(builders.shops[1].upsert).not.toHaveBeenCalled();
  });

  it("falls back to matching by (user_id, name, platform) when there's no store_url (createShop, Sheets-only)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        shops: [
          { data: { id: 3 }, error: null },
          { data: { id: 3 }, error: null },
        ],
      },
    });
    holder.client = client;

    await createOrUpdateShop({
      name: "AYLA",
      platform: "Shopify",
      sheetId: null,
      sheetName: null,
      userId: "user-1",
    });

    expect(builders.shops[0].eq).toHaveBeenCalledWith("name", "AYLA");
    expect(builders.shops[0].eq).not.toHaveBeenCalledWith("store_url", expect.anything());
  });

  it("inserts a new shop when sheetId is null, userId is present, but no existing shop matches", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        shops: [
          { data: null, error: null }, // SELECT: no match
          { data: { id: 99 }, error: null }, // falls through to the original upsert
        ],
      },
    });
    holder.client = client;

    const result = await createOrUpdateShop({
      name: "New Shop",
      platform: "Shopify",
      sheetId: null,
      sheetName: null,
      userId: "user-1",
    });

    expect(result).toEqual({ id: 99 });
    expect(builders.shops[1].upsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Shop", sheet_id: null }),
      { onConflict: "sheet_id" }
    );
  });

  it("limits the lookup to 1 row, so an already-duplicated shop converges on one row instead of silently falling through to another insert", async () => {
    // Regression guard for @supabase/postgrest-js's maybeSingle() behavior
    // when >1 row matches: it returns { data: null, error: PGRST116 }
    // rather than throwing, which — without .limit(1) — this call site
    // would silently misread as "no existing shop found".
    const { client, builders } = createMockSupabase({
      responses: {
        shops: [
          { data: { id: 8 }, error: null },
          { data: { id: 8 }, error: null },
        ],
      },
    });
    holder.client = client;

    await createOrUpdateShop({
      name: "AYLA",
      platform: "Shopify",
      sheetId: null,
      sheetName: null,
      userId: "user-1",
      storeUrl: "https://ayla.myshopify.com",
    });

    expect(builders.shops[0].limit).toHaveBeenCalledWith(1);
  });

  it("orders the lookup by id ascending before limiting to 1, so an already-duplicated shop always resolves to the oldest row", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        shops: [
          { data: { id: 8 }, error: null },
          { data: { id: 8 }, error: null },
        ],
      },
    });
    holder.client = client;

    await createOrUpdateShop({
      name: "AYLA",
      platform: "Shopify",
      sheetId: null,
      sheetName: null,
      userId: "user-1",
      storeUrl: "https://ayla.myshopify.com",
    });

    expect(builders.shops[0].order).toHaveBeenCalledWith("id", { ascending: true });
  });

  it("does not attempt the lookup when userId is absent (webhook path, unchanged behavior)", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: { id: 55 }, error: null } },
    });
    holder.client = client;

    await createOrUpdateShop({
      name: "Webhook Shop",
      platform: "Shopify",
      sheetId: null,
      sheetName: null,
    });

    // Exactly one .from("shops") call — straight to the original upsert.
    expect(builders.shops).toHaveLength(1);
    expect(builders.shops[0].upsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Webhook Shop", sheet_id: null }),
      { onConflict: "sheet_id" }
    );
  });
});
