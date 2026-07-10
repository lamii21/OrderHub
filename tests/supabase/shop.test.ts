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
});
