import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../../../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { findPromoCodeByCode } from "@/lib/agent/tools/promo-codes/repository";

const promoCodeRow = {
  discount_type: "percentage",
  discount_value: 15,
  expires_at: "2026-12-31T23:59:59.000Z",
};

describe("findPromoCodeByCode", () => {
  it("scopes by shop_id and matches the code case-insensitively", async () => {
    const { client, builders } = createMockSupabase({
      responses: { promo_codes: { data: promoCodeRow, error: null } },
    });
    holder.client = client;

    const result = await findPromoCodeByCode(15, "welcome10");

    expect(builders.promo_codes[0].select).toHaveBeenCalledWith("discount_type, discount_value, expires_at");
    expect(builders.promo_codes[0].eq).toHaveBeenCalledWith("shop_id", 15);
    expect(builders.promo_codes[0].ilike).toHaveBeenCalledWith("code", "welcome10");
    expect(result).toEqual(promoCodeRow);
  });

  it("escapes ILIKE wildcard characters in the code before matching", async () => {
    const { client, builders } = createMockSupabase({
      responses: { promo_codes: { data: null, error: null } },
    });
    holder.client = client;

    await findPromoCodeByCode(15, "50%_OFF");

    expect(builders.promo_codes[0].ilike).toHaveBeenCalledWith("code", "50\\%\\_OFF");
  });

  it("returns null when no code matches", async () => {
    const { client } = createMockSupabase({ responses: { promo_codes: { data: null, error: null } } });
    holder.client = client;

    await expect(findPromoCodeByCode(15, "DOES-NOT-EXIST")).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { promo_codes: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(findPromoCodeByCode(15, "WELCOME10")).rejects.toThrow("db down");
  });
});
