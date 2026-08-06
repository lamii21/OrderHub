import { findPromoCodeByCode, type PromoCodeDiscountType } from "./repository";

export type PromoCodeValidityResult =
  | { valid: true; discount_type: PromoCodeDiscountType; discount_value: number }
  | { valid: false; reason: "not_found" | "expired" };

// Checks existence and expiry only — it can never report "already
// redeemed". No part of this codebase tracks promo code redemption
// (lib/automation-modules/promo-code.ts's own comment: "promo_codes only
// records that a code was issued, never whether it was actually used");
// adding that tracking was deliberately deferred (Phase 6 Étape 6.4) to a
// future evolution, not built here. A code already used elsewhere still
// validates as usable — a known, documented limitation, not an oversight.
export async function checkPromoCodeValidity(shopId: number, code: string): Promise<PromoCodeValidityResult> {
  const promoCode = await findPromoCodeByCode(shopId, code);

  if (!promoCode) {
    return { valid: false, reason: "not_found" };
  }

  if (promoCode.expires_at !== null && new Date(promoCode.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, discount_type: promoCode.discount_type, discount_value: promoCode.discount_value };
}
