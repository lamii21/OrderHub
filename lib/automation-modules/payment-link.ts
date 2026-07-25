import { getModuleCredentials } from "./credentials";
import { supabase } from "@/lib/supabase";
import { fetchWithTimeout, isTimeoutError } from "./http";
import type { AutomationModule } from "./types";

// UNVERIFIED AGAINST A LIVE STRIPE ACCOUNT. Built directly against
// Stripe's public Payment Links API reference (a stable, long-documented
// REST API), unlike lib/platforms/youcan.ts's genuinely unknown shape —
// but never actually exercised against a real account in this session:
// doing so needs a real (even test-mode) secret key only the account
// owner can provide. Before relying on this: configure a Stripe
// test-mode key via app/shops/[id]/integrations, run a real order
// through it, and confirm the returned URL opens a working Checkout page.
const STRIPE_API_BASE = "https://api.stripe.com/v1";

type PaymentLinkConfig = { description?: string };
type StripeCredentials = { apiKey: string };

function isStripeCredentials(value: Record<string, unknown> | null): value is StripeCredentials {
  return !!value && typeof value.apiKey === "string";
}

// Creates a one-off Stripe Payment Link for exactly this order's amount
// via line_items[].price_data — Stripe's API accepts ad-hoc pricing this
// way, so no Product/Price has to be pre-created in the merchant's
// Stripe dashboard. Returns the link via ModuleResult.data rather than
// sending it itself: same "generate here, a later message step sends it"
// split as Delivery's tracking number and the Promo Code module, so
// sending logic isn't duplicated across every module that produces
// something worth telling the customer.
export const paymentLinkModule: AutomationModule = {
  validateConfig(config) {
    const { description } = config as Partial<PaymentLinkConfig>;

    if (description !== undefined && (typeof description !== "string" || description.length > 500)) {
      return "description, when provided, must be a string of at most 500 characters.";
    }

    return null;
  },

  async run(order, config) {
    const { description } = config as PaymentLinkConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    if (order.price === null || order.quantity === null) {
      return { success: false, message: "Order is missing a price or quantity." };
    }

    const credentials = await getModuleCredentials(order.shop_id, "payment-link");
    if (!isStripeCredentials(credentials)) {
      return { success: false, message: "Payment Link is not configured for this shop." };
    }

    const { data: shop } = await supabase
      .from("shops")
      .select("currency")
      .eq("id", order.shop_id)
      .maybeSingle();

    // Stripe wants the smallest currency unit (cents for USD/EUR) and a
    // lowercase 3-letter currency code.
    const currency = (shop?.currency ?? "USD").toLowerCase();
    const unitAmount = Math.round(order.price * 100);

    const body = new URLSearchParams();
    body.set("line_items[0][price_data][currency]", currency);
    body.set("line_items[0][price_data][product_data][name]", description || order.product || "Order");
    body.set("line_items[0][price_data][unit_amount]", String(unitAmount));
    body.set("line_items[0][quantity]", String(order.quantity));

    try {
      const response = await fetchWithTimeout(`${STRIPE_API_BASE}/payment_links`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        return { success: false, message: `Stripe request failed (HTTP ${response.status}).` };
      }

      const responseBody = (await response.json()) as { id?: string; url?: string };

      if (!responseBody.url) {
        return { success: false, message: "Stripe did not return a payment link URL." };
      }

      return {
        success: true,
        message: "Payment link created.",
        data: { paymentLinkUrl: responseBody.url, paymentLinkId: responseBody.id },
      };
    } catch (err) {
      console.error("paymentLinkModule: request failed:", err);
      return {
        success: false,
        message: isTimeoutError(err)
          ? "Stripe request timed out."
          : "Stripe request failed (network error).",
      };
    }
  },
};
