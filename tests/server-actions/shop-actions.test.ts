import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));

import { deleteShop, updateShopName, disconnectStore, updateSyncFrequency } from "@/app/shops/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("deleteShop", () => {
  it("rejects a non-numeric shop_id without touching the database", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(deleteShop(formData({ shop_id: "not-a-number" }))).rejects.toThrow(
      /REDIRECT:\/shops\?error=/
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects a negative shop_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(deleteShop(formData({ shop_id: "-1" }))).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("deletes orders, then products, then the shop, in that order, and redirects with deleted=1", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        orders: { data: null, error: null },
        products: { data: null, error: null },
        shops: { data: null, error: null },
      },
    });
    holder.client = client;

    await expect(deleteShop(formData({ shop_id: "5" }))).rejects.toThrow("REDIRECT:/shops?deleted=1");

    expect(client.from).toHaveBeenNthCalledWith(1, "orders");
    expect(client.from).toHaveBeenNthCalledWith(2, "products");
    expect(client.from).toHaveBeenNthCalledWith(3, "shops");
    expect(builders.orders[0].eq).toHaveBeenCalledWith("shop_id", 5);
    expect(builders.products[0].eq).toHaveBeenCalledWith("shop_id", 5);
    expect(builders.shops[0].eq).toHaveBeenCalledWith("id", 5);
  });

  it("stops and redirects with an error if deleting orders fails, without touching products or shops", async () => {
    const { client } = createMockSupabase({
      responses: { orders: { data: null, error: { message: "constraint violation" } } },
    });
    holder.client = client;

    await expect(deleteShop(formData({ shop_id: "5" }))).rejects.toThrow(
      /REDIRECT:\/shops\?error=.*orders/
    );
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("stops and redirects with an error if deleting the shop itself fails (e.g. an FK this migration didn't cover)", async () => {
    const { client } = createMockSupabase({
      responses: {
        orders: { data: null, error: null },
        products: { data: null, error: null },
        shops: { data: null, error: { message: "still referenced" } },
      },
    });
    holder.client = client;

    await expect(deleteShop(formData({ shop_id: "5" }))).rejects.toThrow(
      /REDIRECT:\/shops\?error=.*shop/
    );
  });
});

describe("updateShopName", () => {
  it("rejects an invalid shop_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(updateShopName(formData({ shop_id: "abc", name: "Acme" }))).rejects.toThrow(
      /REDIRECT:\/shops\?error=/
    );
  });

  it("rejects an empty name", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(updateShopName(formData({ shop_id: "5", name: "   " }))).rejects.toThrow(
      /REDIRECT:\/shops\/5\?error=/
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("updates the name and redirects to the shop page", async () => {
    const { client, builders } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(updateShopName(formData({ shop_id: "5", name: "New Name" }))).rejects.toThrow(
      "REDIRECT:/shops/5"
    );
    expect(builders.shops[0].update).toHaveBeenCalledWith({ name: "New Name" });
  });
});

describe("disconnectStore", () => {
  it("rejects an invalid shop_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(disconnectStore(formData({ shop_id: "0" }))).rejects.toThrow(/REDIRECT:\/shops\?error=/);
  });

  it("nulls the 3 credential columns and stamps credentials_changed_at", async () => {
    const { client, builders } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(disconnectStore(formData({ shop_id: "5" }))).rejects.toThrow(
      "REDIRECT:/shops/5?disconnected=1"
    );

    const payload = builders.shops[0].update.mock.calls[0][0];
    expect(payload.store_url).toBeNull();
    expect(payload.api_key).toBeNull();
    expect(payload.api_secret).toBeNull();
    expect(typeof payload.credentials_changed_at).toBe("string");
  });
});

describe("updateSyncFrequency", () => {
  it("rejects an invalid shop_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateSyncFrequency(formData({ shop_id: "-5", sync_frequency: "daily" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
  });

  it("rejects an invalid frequency", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateSyncFrequency(formData({ shop_id: "5", sync_frequency: "every_minute" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/5\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("updates the frequency and redirects to the shop page", async () => {
    const { client, builders } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(
      updateSyncFrequency(formData({ shop_id: "5", sync_frequency: "every_6h" }))
    ).rejects.toThrow("REDIRECT:/shops/5");
    expect(builders.shops[0].update).toHaveBeenCalledWith({ sync_frequency: "every_6h" });
  });
});
