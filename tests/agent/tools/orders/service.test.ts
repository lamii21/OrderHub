import { describe, it, expect, vi, beforeEach } from "vitest";

const { findOrderByOrderId, findMostRecentOrderForCustomer, searchOrdersForCustomer } = vi.hoisted(() => ({
  findOrderByOrderId: vi.fn(),
  findMostRecentOrderForCustomer: vi.fn(),
  searchOrdersForCustomer: vi.fn(),
}));

vi.mock("@/lib/agent/tools/orders/repository", () => ({
  findOrderByOrderId,
  findMostRecentOrderForCustomer,
  searchOrdersForCustomer,
}));

import { getOrderStatusForCustomer, searchOrdersForCustomer as searchOrdersForCustomerService, DEFAULT_ORDER_SEARCH_LIMIT } from "@/lib/agent/tools/orders/service";

const order = {
  order_id: "ORD-1001",
  product: "Veste en jean",
  quantity: 1,
  price: 350,
  status: "shipped" as const,
  created_at: "2026-08-05T10:00:00.000Z",
};

beforeEach(() => {
  findOrderByOrderId.mockReset();
  findMostRecentOrderForCustomer.mockReset();
  searchOrdersForCustomer.mockReset();
});

describe("getOrderStatusForCustomer", () => {
  it("looks up by order_id when one is given", async () => {
    findOrderByOrderId.mockResolvedValue(order);

    const result = await getOrderStatusForCustomer(15, 42, "ORD-1001");

    expect(findOrderByOrderId).toHaveBeenCalledWith(15, 42, "ORD-1001");
    expect(findMostRecentOrderForCustomer).not.toHaveBeenCalled();
    expect(result).toEqual({ found: true, order });
  });

  it("falls back to the most recent order when no order_id is given", async () => {
    findMostRecentOrderForCustomer.mockResolvedValue(order);

    const result = await getOrderStatusForCustomer(15, 42);

    expect(findMostRecentOrderForCustomer).toHaveBeenCalledWith(15, 42);
    expect(findOrderByOrderId).not.toHaveBeenCalled();
    expect(result).toEqual({ found: true, order });
  });

  it("returns found: false when nothing matches, by order_id", async () => {
    findOrderByOrderId.mockResolvedValue(null);
    await expect(getOrderStatusForCustomer(15, 42, "does-not-exist")).resolves.toEqual({ found: false });
  });

  it("returns found: false when nothing matches, with no order_id", async () => {
    findMostRecentOrderForCustomer.mockResolvedValue(null);
    await expect(getOrderStatusForCustomer(15, 42)).resolves.toEqual({ found: false });
  });
});

describe("searchOrdersForCustomer (service)", () => {
  it("passes shop_id, customer_id, and filters through, with the fixed default limit", async () => {
    searchOrdersForCustomer.mockResolvedValue([order]);

    const result = await searchOrdersForCustomerService(15, 42, { status: "shipped", product: "veste" });

    expect(searchOrdersForCustomer).toHaveBeenCalledWith(15, 42, { status: "shipped", product: "veste" }, DEFAULT_ORDER_SEARCH_LIMIT);
    expect(result).toEqual({ orders: [order] });
  });

  it("wraps an empty result the same way", async () => {
    searchOrdersForCustomer.mockResolvedValue([]);

    const result = await searchOrdersForCustomerService(15, 42, {});

    expect(result).toEqual({ orders: [] });
  });
});
