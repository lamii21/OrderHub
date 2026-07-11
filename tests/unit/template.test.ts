import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/automation-modules/template";
import type { Order } from "@/types/order";

const fullOrder = {
  id: 1,
  order_id: "ORD-1",
  customer_name: "Amina",
  customer_phone: "0600000000",
  customer_city: "Rabat",
  customer_address: "1 Rue X",
  customer_email: "amina@example.com",
  product: "T-Shirt",
  quantity: 2,
  price: 19.99,
  status: "confirmed",
} as Order;

describe("renderTemplate", () => {
  it("substitutes every recognized variable", () => {
    const result = renderTemplate(
      "{{customer_name}} ({{customer_phone}}) in {{customer_city}}, {{customer_address}}, {{customer_email}} ordered {{quantity}}x {{product}} for {{price}} — order {{order_id}}, status {{status}}",
      fullOrder
    );

    expect(result).toBe(
      "Amina (0600000000) in Rabat, 1 Rue X, amina@example.com ordered 2x T-Shirt for 19.99 — order ORD-1, status confirmed"
    );
  });

  it("falls back to an empty string for null text fields, rather than the literal 'null'", () => {
    const result = renderTemplate(
      "[{{customer_name}}][{{customer_phone}}][{{customer_city}}][{{customer_address}}][{{customer_email}}][{{product}}]",
      {
        ...fullOrder,
        customer_name: null,
        customer_phone: null,
        customer_city: null,
        customer_address: null,
        customer_email: null,
        product: null,
      }
    );

    expect(result).toBe("[][][][][][]");
  });

  it("falls back to an empty string for null quantity/price", () => {
    const result = renderTemplate("qty={{quantity}} price={{price}}", {
      ...fullOrder,
      quantity: null,
      price: null,
    });

    expect(result).toBe("qty= price=");
  });

  it("falls back to the numeric id when order_id is null", () => {
    const result = renderTemplate("{{order_id}}", { ...fullOrder, order_id: null, id: 42 });
    expect(result).toBe("42");
  });

  it("leaves an unrecognized {{variable}} exactly as-is (a typo degrades visibly, not silently)", () => {
    const result = renderTemplate("Hello {{customer_nmae}}", fullOrder);
    expect(result).toBe("Hello {{customer_nmae}}");
  });

  it("tolerates extra whitespace inside the braces", () => {
    const result = renderTemplate("{{  customer_name  }}", fullOrder);
    expect(result).toBe("Amina");
  });

  it("substitutes the same variable every time it appears", () => {
    const result = renderTemplate("{{product}} / {{product}}", fullOrder);
    expect(result).toBe("T-Shirt / T-Shirt");
  });
});
