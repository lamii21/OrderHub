import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCustomerStatsForCustomer } = vi.hoisted(() => ({ getCustomerStatsForCustomer: vi.fn() }));

vi.mock("@/lib/agent/tools/customers/service", () => ({ getCustomerStatsForCustomer }));

import { getCustomerTool } from "@/lib/agent/tools/customers/tool";

const stats = { order_count: 3, ltv: 900, last_order_at: "2026-08-01T00:00:00.000Z" };

beforeEach(() => {
  getCustomerStatsForCustomer.mockReset();
});

describe("getCustomerTool", () => {
  it("declares a name and takes no parameters", () => {
    expect(getCustomerTool.name).toBe("get_customer");
    expect(getCustomerTool.parameters).toEqual({ type: "object", properties: {} });
  });

  it("declines to answer, without ever calling the service, when the conversation has no identified customer", async () => {
    const result = await getCustomerTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: null });

    expect(result).toEqual({ found: false, reason: "no_customer_identified" });
    expect(getCustomerStatsForCustomer).not.toHaveBeenCalled();
  });

  it("passes shop_id and customer_id from context, ignoring anything in args", async () => {
    getCustomerStatsForCustomer.mockResolvedValue({ found: true, stats });

    await getCustomerTool.execute({ customer_id: 999 }, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(getCustomerStatsForCustomer).toHaveBeenCalledWith(15, 42);
  });

  it("returns the found stats as-is", async () => {
    getCustomerStatsForCustomer.mockResolvedValue({ found: true, stats });

    const result = await getCustomerTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(result).toEqual({ found: true, stats });
  });

  it("returns a not_found reason when the service finds nothing", async () => {
    getCustomerStatsForCustomer.mockResolvedValue({ found: false });

    const result = await getCustomerTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(result).toEqual({ found: false, reason: "not_found" });
  });
});
