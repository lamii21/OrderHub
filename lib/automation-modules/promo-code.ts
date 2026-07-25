import { randomBytes } from "crypto";
import { supabase } from "@/lib/supabase";
import type { AutomationModule } from "./types";

type PromoCodeConfig = {
  discountType: "percentage" | "fixed";
  discountValue: number;
  expiresInDays?: number;
  codePrefix?: string;
};

function generateCode(prefix?: string): string {
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return prefix ? `${prefix}-${suffix}` : suffix;
}

// Generates and stores a discount code for this order's customer — a
// retention/marketing action, not a checkout-time discount: OrderHub
// never sees or controls the merchant's platform checkout, so it has no
// way to actually apply this code to a sale, only to hand one out. A
// later message step (WhatsApp/SMS/Email/Slack) sends it to the customer
// by referencing {{promo_code}}/{{discount_value}} — same context-passing
// pattern already built for the Delivery module's tracking number (see
// template.ts's own comment).
//
// "Redeemed" is deliberately not tracked: nothing in this pipeline
// (Sheets/webhook payload) ever reports a promo code back, so
// promo_codes only records that a code was issued, never whether it was
// actually used.
export const promoCodeModule: AutomationModule = {
  validateConfig(config) {
    const { discountType, discountValue, expiresInDays } = config as Partial<PromoCodeConfig>;

    if (discountType !== "percentage" && discountType !== "fixed") {
      return 'discountType must be "percentage" or "fixed".';
    }

    if (typeof discountValue !== "number" || !Number.isFinite(discountValue) || discountValue <= 0) {
      return "discountValue must be a positive number.";
    }

    if (discountType === "percentage" && discountValue > 100) {
      return "discountValue cannot exceed 100 for a percentage discount.";
    }

    if (expiresInDays !== undefined && (typeof expiresInDays !== "number" || expiresInDays <= 0)) {
      return "expiresInDays, when provided, must be a positive number.";
    }

    return null;
  },

  async run(order, config) {
    const { discountType, discountValue, expiresInDays, codePrefix } = config as PromoCodeConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    const code = generateCode(codePrefix);
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data, error } = await supabase
      .from("promo_codes")
      .insert({
        shop_id: order.shop_id,
        customer_id: order.customer_id,
        code,
        discount_type: discountType,
        discount_value: discountValue,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("promoCodeModule: failed to create promo code:", error);
      return { success: false, message: "Could not create the promo code." };
    }

    return {
      success: true,
      message: `Promo code ${code} created.`,
      data: { code, discountType, discountValue, expiresAt },
    };
  },
};
