import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  isValidOrderStatus,
  validateOrderPayload,
  parsePositiveInt,
  ORDER_STATUSES,
} from "@/lib/validation";

describe("isValidEmail", () => {
  it("accepts a plausible email", () => {
    expect(isValidEmail("owner@example.com")).toBe(true);
  });

  it("rejects a string with no @", () => {
    expect(isValidEmail("owner.example.com")).toBe(false);
  });

  it("rejects a string with no domain dot", () => {
    expect(isValidEmail("owner@example")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });
});

describe("isValidOrderStatus", () => {
  it.each(ORDER_STATUSES)("accepts %s", (status) => {
    expect(isValidOrderStatus(status)).toBe(true);
  });

  it("rejects an unknown status string", () => {
    expect(isValidOrderStatus("archived")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidOrderStatus(42)).toBe(false);
    expect(isValidOrderStatus(null)).toBe(false);
    expect(isValidOrderStatus(undefined)).toBe(false);
  });
});

describe("validateOrderPayload", () => {
  const validPayload = {
    customer_name: "Amina",
    product: "T-shirt",
    quantity: 2,
    price: 19.99,
  };

  it("accepts a valid payload with no status", () => {
    expect(validateOrderPayload(validPayload)).toBeNull();
  });

  it("accepts a valid payload with a valid status", () => {
    expect(validateOrderPayload({ ...validPayload, status: "confirmed" })).toBeNull();
  });

  it("rejects a missing customer_name", () => {
    const { customer_name, ...rest } = validPayload;
    expect(validateOrderPayload(rest)).toBe("customer_name must be a string");
  });

  it("rejects a missing product", () => {
    const { product, ...rest } = validPayload;
    expect(validateOrderPayload(rest)).toBe("product must be a string");
  });

  it("rejects a zero quantity", () => {
    expect(validateOrderPayload({ ...validPayload, quantity: 0 })).toBe(
      "quantity must be a positive number"
    );
  });

  it("rejects a negative quantity", () => {
    expect(validateOrderPayload({ ...validPayload, quantity: -1 })).toBe(
      "quantity must be a positive number"
    );
  });

  it("rejects a non-finite quantity", () => {
    expect(validateOrderPayload({ ...validPayload, quantity: Infinity })).toBe(
      "quantity must be a positive number"
    );
  });

  it("rejects a non-numeric price", () => {
    expect(validateOrderPayload({ ...validPayload, price: "19.99" })).toBe(
      "price must be a valid number"
    );
  });

  it("rejects an invalid status", () => {
    expect(validateOrderPayload({ ...validPayload, status: "shipped-out" })).toBe(
      `status must be one of: ${ORDER_STATUSES.join(", ")}`
    );
  });

  it("allows a null status (treated as omitted)", () => {
    expect(validateOrderPayload({ ...validPayload, status: null })).toBeNull();
  });

  it("accepts customer_phone/customer_city/customer_address when omitted entirely", () => {
    expect(validateOrderPayload(validPayload)).toBeNull();
  });

  it("accepts string customer_phone/customer_city/customer_address", () => {
    expect(
      validateOrderPayload({
        ...validPayload,
        customer_phone: "0600000000",
        customer_city: "Rabat",
        customer_address: "1 Rue X",
      })
    ).toBeNull();
  });

  it("rejects a non-string customer_phone", () => {
    expect(validateOrderPayload({ ...validPayload, customer_phone: 600000000 })).toBe(
      "customer_phone must be a string of at most 500 characters"
    );
  });

  it("rejects an unreasonably long customer_address", () => {
    expect(
      validateOrderPayload({ ...validPayload, customer_address: "x".repeat(501) })
    ).toBe("customer_address must be a string of at most 500 characters");
  });

  it("accepts a customer_city exactly at the length cap", () => {
    expect(validateOrderPayload({ ...validPayload, customer_city: "x".repeat(500) })).toBeNull();
  });
});

describe("parsePositiveInt", () => {
  it("parses a valid positive integer string", () => {
    expect(parsePositiveInt("42")).toBe(42);
  });

  it("rejects zero", () => {
    expect(parsePositiveInt("0")).toBeNull();
  });

  it("rejects a negative number", () => {
    expect(parsePositiveInt("-1")).toBeNull();
  });

  it("rejects a non-numeric string", () => {
    expect(parsePositiveInt("abc")).toBeNull();
  });

  it("rejects a decimal", () => {
    expect(parsePositiveInt("1.5")).toBeNull();
  });

  it("rejects null, empty string, and non-string values", () => {
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt("")).toBeNull();
    expect(parsePositiveInt("   ")).toBeNull();
  });

  it("rejects a FormData File value", () => {
    expect(parsePositiveInt(new File([], "test.txt"))).toBeNull();
  });
});
