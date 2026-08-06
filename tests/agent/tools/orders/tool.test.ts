import { describe, it, expect, vi, beforeEach } from "vitest";

const { getOrderStatusForCustomer } = vi.hoisted(() => ({ getOrderStatusForCustomer: vi.fn() }));

vi.mock("@/lib/agent/tools/orders/service", () => ({ getOrderStatusForCustomer }));

import { getOrderStatusTool } from "@/lib/agent/tools/orders/tool";

const order = {
  order_id: "ORD-1001",
  product: "Veste en jean",
  quantity: 1,
  price: 350,
  status: "shipped" as const,
  created_at: "2026-08-05T10:00:00.000Z",
};

beforeEach(() => {
  getOrderStatusForCustomer.mockReset();
});

describe("getOrderStatusTool", () => {
  it("declares a name and a parameters schema with an optional order_id", () => {
    expect(getOrderStatusTool.name).toBe("get_order_status");
    expect(getOrderStatusTool.parameters).toMatchObject({
      type: "object",
      properties: { order_id: { type: "string" } },
    });
  });

  it("declines to answer, without ever calling the service, when the conversation has no identified customer", async () => {
    const result = await getOrderStatusTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: null });

    expect(result).toEqual({ found: false, reason: "no_customer_identified" });
    expect(getOrderStatusForCustomer).not.toHaveBeenCalled();
  });

  it("passes shop_id and the resolved customer_id from context, never from args", async () => {
    getOrderStatusForCustomer.mockResolvedValue({ found: true, order });

    await getOrderStatusTool.execute(
      { order_id: "ORD-1001", customer_id: 999 },
      { shop_id: 15, conversation_id: 1, customer_id: 42 }
    );

    expect(getOrderStatusForCustomer).toHaveBeenCalledWith(15, 42, "ORD-1001");
  });

  it("omits order_id when the argument isn't a string", async () => {
    getOrderStatusForCustomer.mockResolvedValue({ found: false });

    await getOrderStatusTool.execute({ order_id: 1001 }, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(getOrderStatusForCustomer).toHaveBeenCalledWith(15, 42, undefined);
  });

  it("returns the found order as-is", async () => {
    getOrderStatusForCustomer.mockResolvedValue({ found: true, order });

    const result = await getOrderStatusTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(result).toEqual({ found: true, order });
  });

  it("returns a not_found reason when the service finds nothing", async () => {
    getOrderStatusForCustomer.mockResolvedValue({ found: false });

    const result = await getOrderStatusTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(result).toEqual({ found: false, reason: "not_found" });
  });
});
