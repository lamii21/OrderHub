import { supabase } from "@/lib/supabase";
import { escapeLikePattern } from "../shared";

// Pure Supabase I/O — no decisions here, same rule as the other tools/*
// repositories. Scoped by shop_id only, matching the promo_codes_shop_code_key
// unique index (supabase/schema.sql) — a code is only ever meaningful
// within one shop.
//
// Column list deliberately excludes id, customer_id, and code itself (the
// caller already has the code it searched for) — a customer-facing tool
// has no use for who a code was originally issued to or Supabase's own
// primary key.
const PROMO_CODE_COLUMNS = "discount_type, discount_value, expires_at";

export type PromoCodeDiscountType = "percentage" | "fixed";

export type PromoCodeRow = {
  discount_type: PromoCodeDiscountType;
  discount_value: number;
  expires_at: string | null;
};

// ILIKE with no surrounding wildcards is a case-insensitive exact match —
// codes are generated uppercase (lib/automation-modules/promo-code.ts), but
// a customer typing one back has no reason to preserve case exactly.
// escapeLikePattern still matters here even without added wildcards: a
// literal % or _ inside the code itself (an unusual but possible
// codePrefix) must not be interpreted as pattern syntax.
export async function findPromoCodeByCode(shopId: number, code: string): Promise<PromoCodeRow | null> {
  const { data, error } = await supabase
    .from("promo_codes")
    .select(PROMO_CODE_COLUMNS)
    .eq("shop_id", shopId)
    .ilike("code", escapeLikePattern(code))
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
