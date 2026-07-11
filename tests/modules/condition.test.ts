import { describe, it, expect } from "vitest";
import { conditionModule } from "@/lib/automation-modules/condition";
import type { Order } from "@/types/order";

const baseOrder = {
  id: 1,
  price: 199,
  quantity: 2,
  status: "confirmed",
  customer_city: "Rabat",
  shops: { name: "Acme", platform: "Shopify" },
} as Order;

describe("conditionModule.validateConfig", () => {
  it("accepts a field/operator/value from the allowed whitelist", () => {
    expect(
      conditionModule.validateConfig!({ field: "price", operator: ">", value: 100 })
    ).toBeNull();
  });

  it("rejects a field outside the whitelist", () => {
    expect(
      conditionModule.validateConfig!({ field: "secret_column", operator: "==", value: 1 })
    ).toMatch(/field must be one of/);
  });

  it("rejects an unsupported operator", () => {
    expect(
      conditionModule.validateConfig!({ field: "price", operator: "~=", value: 1 })
    ).toMatch(/operator must be one of/);
  });

  it("rejects a missing comparison value", () => {
    expect(conditionModule.validateConfig!({ field: "price", operator: ">", value: "" })).toMatch(
      /comparison value/
    );
  });
});

describe("conditionModule.run", () => {
  it("continues (no outcome) when a numeric comparison is true", async () => {
    const result = await conditionModule.run(
      baseOrder,
      { field: "price", operator: ">", value: 100 },
      {}
    );
    expect(result).toEqual({
      success: true,
      message: "Condition met (price > 100) — continuing.",
    });
    expect(result.outcome).toBeUndefined();
  });

  it("stops the workflow when a numeric comparison is false", async () => {
    const result = await conditionModule.run(
      baseOrder,
      { field: "price", operator: ">", value: 1000 },
      {}
    );
    expect(result.success).toBe(true);
    expect(result.outcome).toBe("stop");
    expect(result.message).toBe("Condition not met (price > 1000) — workflow stopped.");
  });

  it("supports <, >=, <= numerically", async () => {
    expect((await conditionModule.run(baseOrder, { field: "quantity", operator: "<", value: 5 }, {})).outcome).toBeUndefined();
    expect((await conditionModule.run(baseOrder, { field: "quantity", operator: ">=", value: 2 }, {})).outcome).toBeUndefined();
    expect((await conditionModule.run(baseOrder, { field: "quantity", operator: "<=", value: 1 }, {})).outcome).toBe("stop");
  });

  it("compares == / != as strings, so a numeric field matches a merchant-entered string value", async () => {
    const equal = await conditionModule.run(baseOrder, { field: "price", operator: "==", value: "199" }, {});
    expect(equal.outcome).toBeUndefined();

    const notEqual = await conditionModule.run(baseOrder, { field: "status", operator: "!=", value: "cancelled" }, {});
    expect(notEqual.outcome).toBeUndefined();
  });

  it("reads the platform field from the joined shop", async () => {
    const result = await conditionModule.run(
      baseOrder,
      { field: "platform", operator: "==", value: "Shopify" },
      {}
    );
    expect(result.outcome).toBeUndefined();
  });

  it("treats a missing field value as false rather than throwing", async () => {
    const result = await conditionModule.run(
      { ...baseOrder, shops: null },
      { field: "platform", operator: "==", value: "Shopify" },
      {}
    );
    expect(result.outcome).toBe("stop");
  });

  it("treats a non-numeric comparison against a numeric operator as false rather than throwing", async () => {
    const result = await conditionModule.run(
      baseOrder,
      { field: "customer_city", operator: ">", value: "abc" },
      {}
    );
    expect(result.outcome).toBe("stop");
  });

  it("fails cleanly on an invalid field/operator even if validateConfig was somehow bypassed", async () => {
    const badField = await conditionModule.run(
      baseOrder,
      { field: "secret_column", operator: "==", value: 1 },
      {}
    );
    expect(badField).toEqual({
      success: false,
      message: "Condition's field must be one of: price, quantity, status, customer_city, platform.",
    });

    const badOperator = await conditionModule.run(
      baseOrder,
      { field: "price", operator: "~=", value: 1 },
      {}
    );
    expect(badOperator).toEqual({
      success: false,
      message: "Condition's operator must be one of: >, <, >=, <=, ==, !=.",
    });
  });
});
