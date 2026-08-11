import { describe, it, expect, vi, beforeEach } from "vitest";

const { searchOrdersForCustomer } = vi.hoisted(() => ({ searchOrdersForCustomer: vi.fn() }));

vi.mock("@/lib/agent/tools/orders/service", () => ({ searchOrdersForCustomer }));

import { searchOrdersTool } from "@/lib/agent/tools/orders/search-orders-tool";

const order = {
  order_id: "ORD-1001",
  product: "Veste en jean",
  quantity: 1,
  price: 350,
  status: "shipped" as const,
  created_at: "2026-08-05T10:00:00.000Z",
};

beforeEach(() => {
  searchOrdersForCustomer.mockReset();
});

describe("searchOrdersTool", () => {
  it("declares a name and an optional status/product parameters schema", () => {
    expect(searchOrdersTool.name).toBe("search_orders");
    expect(searchOrdersTool.parameters).toMatchObject({
      type: "object",
      properties: {
        status: { type: "string" },
        product: { type: "string" },
      },
    });
  });

  it("declines to answer, without ever calling the service, when the conversation has no identified customer", async () => {
    const result = await searchOrdersTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: null });

    expect(result).toEqual({ orders: [], reason: "no_customer_identified" });
    expect(searchOrdersForCustomer).not.toHaveBeenCalled();
  });

  it("passes shop_id and customer_id from context, never from args", async () => {
    searchOrdersForCustomer.mockResolvedValue({ orders: [order] });

    await searchOrdersTool.execute(
      { customer_id: 999 },
      { shop_id: 15, conversation_id: 1, customer_id: 42 }
    );

    expect(searchOrdersForCustomer).toHaveBeenCalledWith(15, 42, { status: undefined, product: undefined });
  });

  it("passes through a valid status filter", async () => {
    searchOrdersForCustomer.mockResolvedValue({ orders: [order] });

    await searchOrdersTool.execute({ status: "shipped" }, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(searchOrdersForCustomer).toHaveBeenCalledWith(15, 42, { status: "shipped", product: undefined });
  });

  it("silently drops an invalid status rather than erroring", async () => {
    searchOrdersForCustomer.mockResolvedValue({ orders: [] });

    await searchOrdersTool.execute({ status: "not-a-real-status" }, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(searchOrdersForCustomer).toHaveBeenCalledWith(15, 42, { status: undefined, product: undefined });
  });

  it("trims and passes through a product filter, dropping a blank one", async () => {
    searchOrdersForCustomer.mockResolvedValue({ orders: [] });

    await searchOrdersTool.execute({ product: "  veste  " }, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(searchOrdersForCustomer).toHaveBeenCalledWith(15, 42, { status: undefined, product: "veste" });
  });

  it("returns the service result as-is", async () => {
    searchOrdersForCustomer.mockResolvedValue({ orders: [order] });

    const result = await searchOrdersTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(result).toEqual({ orders: [order] });
  });
});
