import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../../../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { findOrderByOrderId, findMostRecentOrderForCustomer } from "@/lib/agent/tools/orders/repository";

const orderRow = {
  order_id: "ORD-1001",
  product: "Veste en jean",
  quantity: 1,
  price: 350,
  status: "shipped",
  created_at: "2026-08-05T10:00:00.000Z",
};

describe("findOrderByOrderId", () => {
  it("scopes the query by shop_id, customer_id, and order_id together", async () => {
    const { client, builders } = createMockSupabase({
      responses: { orders: { data: orderRow, error: null } },
    });
    holder.client = client;

    const result = await findOrderByOrderId(15, 42, "ORD-1001");

    expect(builders.orders[0].select).toHaveBeenCalledWith(
      "order_id, product, quantity, price, status, created_at"
    );
    expect(builders.orders[0].eq).toHaveBeenNthCalledWith(1, "shop_id", 15);
    expect(builders.orders[0].eq).toHaveBeenNthCalledWith(2, "customer_id", 42);
    expect(builders.orders[0].eq).toHaveBeenNthCalledWith(3, "order_id", "ORD-1001");
    expect(result).toEqual(orderRow);
  });

  it("returns null when no order matches", async () => {
    const { client } = createMockSupabase({ responses: { orders: { data: null, error: null } } });
    holder.client = client;

    await expect(findOrderByOrderId(15, 42, "does-not-exist")).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { orders: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(findOrderByOrderId(15, 42, "ORD-1001")).rejects.toThrow("db down");
  });
});

describe("findMostRecentOrderForCustomer", () => {
  it("scopes by shop_id and customer_id, ordered newest-first, limited to one", async () => {
    const { client, builders } = createMockSupabase({
      responses: { orders: { data: orderRow, error: null } },
    });
    holder.client = client;

    const result = await findMostRecentOrderForCustomer(15, 42);

    expect(builders.orders[0].eq).toHaveBeenNthCalledWith(1, "shop_id", 15);
    expect(builders.orders[0].eq).toHaveBeenNthCalledWith(2, "customer_id", 42);
    expect(builders.orders[0].order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(builders.orders[0].limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(orderRow);
  });

  it("returns null when the customer has no orders", async () => {
    const { client } = createMockSupabase({ responses: { orders: { data: null, error: null } } });
    holder.client = client;

    await expect(findMostRecentOrderForCustomer(15, 42)).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { orders: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(findMostRecentOrderForCustomer(15, 42)).rejects.toThrow("db down");
  });
});
