import { describe, it, expect, vi, beforeEach } from "vitest";

const { findPromoCodeByCode } = vi.hoisted(() => ({ findPromoCodeByCode: vi.fn() }));

vi.mock("@/lib/agent/tools/promo-codes/repository", () => ({ findPromoCodeByCode }));

import { checkPromoCodeValidity } from "@/lib/agent/tools/promo-codes/service";

beforeEach(() => {
  findPromoCodeByCode.mockReset();
});

describe("checkPromoCodeValidity", () => {
  it("returns valid: false, reason: not_found when no code matches", async () => {
    findPromoCodeByCode.mockResolvedValue(null);

    await expect(checkPromoCodeValidity(15, "DOES-NOT-EXIST")).resolves.toEqual({
      valid: false,
      reason: "not_found",
    });
  });

  it("returns valid: false, reason: expired for a code whose expires_at is in the past", async () => {
    findPromoCodeByCode.mockResolvedValue({
      discount_type: "percentage",
      discount_value: 15,
      expires_at: "2020-01-01T00:00:00.000Z",
    });

    await expect(checkPromoCodeValidity(15, "EXPIRED10")).resolves.toEqual({ valid: false, reason: "expired" });
  });

  it("returns valid: true with the discount details for a code with no expiry", async () => {
    findPromoCodeByCode.mockResolvedValue({ discount_type: "fixed", discount_value: 50, expires_at: null });

    await expect(checkPromoCodeValidity(15, "FLAT50")).resolves.toEqual({
      valid: true,
      discount_type: "fixed",
      discount_value: 50,
    });
  });

  it("returns valid: true for a code whose expiry is in the future", async () => {
    findPromoCodeByCode.mockResolvedValue({
      discount_type: "percentage",
      discount_value: 15,
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    await expect(checkPromoCodeValidity(15, "WELCOME15")).resolves.toEqual({
      valid: true,
      discount_type: "percentage",
      discount_value: 15,
    });
  });

  it("never reports whether a code has already been redeemed — the result never carries such a field", async () => {
    findPromoCodeByCode.mockResolvedValue({ discount_type: "fixed", discount_value: 50, expires_at: null });

    const result = await checkPromoCodeValidity(15, "FLAT50");

    expect(result).not.toHaveProperty("redeemed");
    expect(result).not.toHaveProperty("redeemed_at");
  });
});
