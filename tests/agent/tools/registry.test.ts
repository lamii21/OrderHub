import { describe, it, expect } from "vitest";
import { getTool, getEnabledTools } from "@/lib/agent/tools/registry";

describe("getTool", () => {
  it("resolves a registered tool by name", () => {
    expect(getTool("get_order_status")?.name).toBe("get_order_status");
    expect(getTool("search_products")?.name).toBe("search_products");
    expect(getTool("check_promo_code")?.name).toBe("check_promo_code");
    expect(getTool("get_customer")?.name).toBe("get_customer");
    expect(getTool("search_orders")?.name).toBe("search_orders");
    expect(getTool("get_invoice")?.name).toBe("get_invoice");
  });

  it("returns null for a name that isn't registered", () => {
    expect(getTool("check_stock")).toBeNull();
    expect(getTool("anything")).toBeNull();
  });
});

describe("getEnabledTools", () => {
  it("resolves enabled, registered names to their ChatTool shape", () => {
    expect(
      getEnabledTools([
        "get_order_status",
        "search_products",
        "check_promo_code",
        "get_customer",
        "search_orders",
        "get_invoice",
      ])
    ).toEqual([
      { name: "get_order_status", description: expect.any(String), parameters: expect.any(Object) },
      { name: "search_products", description: expect.any(String), parameters: expect.any(Object) },
      { name: "check_promo_code", description: expect.any(String), parameters: expect.any(Object) },
      { name: "get_customer", description: expect.any(String), parameters: expect.any(Object) },
      { name: "search_orders", description: expect.any(String), parameters: expect.any(Object) },
      { name: "get_invoice", description: expect.any(String), parameters: expect.any(Object) },
    ]);
  });

  it("silently drops a name that isn't registered, rather than throwing", () => {
    expect(getEnabledTools(["check_stock", "get_order_status"])).toEqual([
      expect.objectContaining({ name: "get_order_status" }),
    ]);
  });

  it("returns an empty array when nothing is enabled", () => {
    expect(getEnabledTools([])).toEqual([]);
  });
});
