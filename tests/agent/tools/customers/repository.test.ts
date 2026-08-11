import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../../../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { getCustomerStats } from "@/lib/agent/tools/customers/repository";

describe("getCustomerStats", () => {
  it("returns null and never calls the RPC when the customer doesn't belong to this shop", async () => {
    const { client } = createMockSupabase({
      responses: { customers: { data: null, error: null } },
    });
    holder.client = client;

    const result = await getCustomerStats(15, 42);

    expect(result).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("scopes the ownership check by id and shop_id together", async () => {
    const { client, builders } = createMockSupabase({
      responses: { customers: { data: { id: 42 }, error: null } },
      rpc: {
        get_customer_stats: {
          data: [{ order_count: 3, ltv: 900, last_order_at: "2026-08-01T00:00:00.000Z" }],
          error: null,
        },
      },
    });
    holder.client = client;

    await getCustomerStats(15, 42);

    expect(builders.customers[0].select).toHaveBeenCalledWith("id");
    expect(builders.customers[0].eq).toHaveBeenNthCalledWith(1, "id", 42);
    expect(builders.customers[0].eq).toHaveBeenNthCalledWith(2, "shop_id", 15);
  });

  it("calls the RPC with p_customer_id and returns the first row once ownership is confirmed", async () => {
    const stats = { order_count: 3, ltv: 900, last_order_at: "2026-08-01T00:00:00.000Z" };
    const { client } = createMockSupabase({
      responses: { customers: { data: { id: 42 }, error: null } },
      rpc: { get_customer_stats: { data: [stats], error: null } },
    });
    holder.client = client;

    const result = await getCustomerStats(15, 42);

    expect(client.rpc).toHaveBeenCalledWith("get_customer_stats", { p_customer_id: 42 });
    expect(result).toEqual(stats);
  });

  it("returns null when the RPC returns no rows", async () => {
    const { client } = createMockSupabase({
      responses: { customers: { data: { id: 42 }, error: null } },
      rpc: { get_customer_stats: { data: [], error: null } },
    });
    holder.client = client;

    await expect(getCustomerStats(15, 42)).resolves.toBeNull();
  });

  it("throws on an ownership-check query error", async () => {
    const { client } = createMockSupabase({
      responses: { customers: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(getCustomerStats(15, 42)).rejects.toThrow("db down");
  });

  it("throws on an RPC error", async () => {
    const { client } = createMockSupabase({
      responses: { customers: { data: { id: 42 }, error: null } },
      rpc: { get_customer_stats: { data: null, error: { message: "rpc failed" } } },
    });
    holder.client = client;

    await expect(getCustomerStats(15, 42)).rejects.toThrow("rpc failed");
  });
});
