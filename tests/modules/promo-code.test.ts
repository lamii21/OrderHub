import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { promoCodeModule } from "@/lib/automation-modules/promo-code";
import type { Order } from "@/types/order";

const order = { id: 1, shop_id: 7, customer_id: 42, customer_name: "Amina" } as Order;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("promoCodeModule.validateConfig", () => {
  it("rejects a missing/invalid discountType", () => {
    expect(promoCodeModule.validateConfig!({ discountValue: 10 })).toMatch(/discountType/);
    expect(
      promoCodeModule.validateConfig!({ discountType: "half-off", discountValue: 10 })
    ).toMatch(/discountType/);
  });

  it("rejects a non-positive discountValue", () => {
    expect(
      promoCodeModule.validateConfig!({ discountType: "fixed", discountValue: 0 })
    ).toMatch(/discountValue/);
    expect(
      promoCodeModule.validateConfig!({ discountType: "fixed", discountValue: -5 })
    ).toMatch(/discountValue/);
  });

  it("rejects a percentage discount over 100", () => {
    expect(
      promoCodeModule.validateConfig!({ discountType: "percentage", discountValue: 150 })
    ).toMatch(/100/);
  });

  it("accepts a valid fixed discount with no expiry", () => {
    expect(
      promoCodeModule.validateConfig!({ discountType: "fixed", discountValue: 10 })
    ).toBeNull();
  });

  it("accepts a valid percentage discount with an expiry", () => {
    expect(
      promoCodeModule.validateConfig!({ discountType: "percentage", discountValue: 15, expiresInDays: 30 })
    ).toBeNull();
  });

  it("rejects a non-positive expiresInDays when provided", () => {
    expect(
      promoCodeModule.validateConfig!({ discountType: "fixed", discountValue: 10, expiresInDays: 0 })
    ).toMatch(/expiresInDays/);
  });
});

describe("promoCodeModule.run", () => {
  it("fails cleanly when the order has no shop", async () => {
    const result = await promoCodeModule.run(
      { ...order, shop_id: null },
      { discountType: "fixed", discountValue: 10 },
      {}
    );
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("creates and returns a promo code with the configured discount", async () => {
    const { client, builders } = createMockSupabase({
      responses: { promo_codes: { data: { id: 1 }, error: null } },
    });
    holder.client = client;

    const result = await promoCodeModule.run(
      order,
      { discountType: "percentage", discountValue: 15, codePrefix: "VIP" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({ discountType: "percentage", discountValue: 15 })
    );
    expect((result.data as { code: string }).code).toMatch(/^VIP-[0-9A-F]{8}$/);

    const payload = builders.promo_codes[0].insert.mock.calls[0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        shop_id: 7,
        customer_id: 42,
        discount_type: "percentage",
        discount_value: 15,
      })
    );
  });

  it("omits a code prefix when none is configured", async () => {
    const { client, builders } = createMockSupabase({
      responses: { promo_codes: { data: { id: 1 }, error: null } },
    });
    holder.client = client;

    await promoCodeModule.run(order, { discountType: "fixed", discountValue: 10 }, {});

    const payload = builders.promo_codes[0].insert.mock.calls[0][0];
    expect(payload.code).toMatch(/^[0-9A-F]{8}$/);
  });

  it("sets expires_at when expiresInDays is provided, null otherwise", async () => {
    const { client, builders } = createMockSupabase({
      responses: { promo_codes: { data: { id: 1 }, error: null } },
    });
    holder.client = client;

    await promoCodeModule.run(order, { discountType: "fixed", discountValue: 10, expiresInDays: 7 }, {});

    const payload = builders.promo_codes[0].insert.mock.calls[0][0];
    expect(payload.expires_at).not.toBeNull();
  });

  it("reports a structured failure when the insert fails", async () => {
    const { client } = createMockSupabase({
      responses: { promo_codes: { data: null, error: { message: "insert failed" } } },
    });
    holder.client = client;

    const result = await promoCodeModule.run(order, { discountType: "fixed", discountValue: 10 }, {});

    expect(result).toEqual({ success: false, message: "Could not create the promo code." });
  });
});
