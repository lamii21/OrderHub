import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { createOrUpdateCustomer } from "@/lib/customer";

describe("createOrUpdateCustomer", () => {
  it("upserts on (shop_id, phone) and returns the row id", async () => {
    const { client, builders } = createMockSupabase({
      responses: { customers: { data: { id: 7 }, error: null } },
    });
    holder.client = client;

    const result = await createOrUpdateCustomer({
      shopId: 1,
      phone: "0600000000",
      name: "Amina",
    });

    expect(result).toEqual({ id: 7 });
    expect(builders.customers[0].upsert).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: 1, phone: "0600000000", name: "Amina" }),
      { onConflict: "shop_id,phone" }
    );
  });

  it("omits city/address/email entirely when not provided (never overwrites with undefined)", async () => {
    const { client, builders } = createMockSupabase({
      responses: { customers: { data: { id: 1 }, error: null } },
    });
    holder.client = client;

    await createOrUpdateCustomer({ shopId: 1, phone: "0600000000" });

    const payload = builders.customers[0].upsert.mock.calls[0][0];
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("city");
    expect(payload).not.toHaveProperty("address");
    expect(payload).not.toHaveProperty("email");
  });

  it("trims the phone before upserting", async () => {
    const { client, builders } = createMockSupabase({
      responses: { customers: { data: { id: 1 }, error: null } },
    });
    holder.client = client;

    await createOrUpdateCustomer({ shopId: 1, phone: "  0600000000  " });

    expect(builders.customers[0].upsert).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "0600000000" }),
      { onConflict: "shop_id,phone" }
    );
  });

  it("throws when the upsert fails", async () => {
    const { client } = createMockSupabase({
      responses: { customers: { data: null, error: { message: "duplicate key" } } },
    });
    holder.client = client;

    await expect(
      createOrUpdateCustomer({ shopId: 1, phone: "0600000000" })
    ).rejects.toThrow("duplicate key");
  });
});
