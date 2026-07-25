import type { Order } from "@/types/order";
import type { WorkflowContext } from "./types";

type DeliveryContextData = {
  trackingNumber?: string;
  carrierName?: string;
  estimatedDelivery?: string;
};

type PromoCodeContextData = {
  code?: string;
  discountType?: "percentage" | "fixed";
  discountValue?: number;
};

type InvoiceContextData = {
  invoiceNumber?: string;
  invoiceAmount?: number;
};

// A fixed, whitelisted set of {{variable}} substitutions — deliberately not
// a general templating engine (no loops, no expressions, no eval). Shared
// by every module that sends a merchant-authored message (WhatsApp, Email,
// SMS, Slack, Notes) so the variable vocabulary stays identical across all
// of them. Unknown variables are left as-is rather than throwing, so a typo
// in a template degrades to visibly-wrong text instead of a failed step.
//
// `context` is optional and, when omitted, behaves exactly as before this
// parameter existed — every existing call site keeps working unchanged.
// When passed, it's the same WorkflowContext the Execution Engine threads
// through every step's run() (lib/workflows/engine.ts) — this is what lets
// a message step reference data a *previous* step in the same run produced
// (e.g. a Delivery step's tracking number in a WhatsApp step right after
// it), instead of only ever seeing the order itself. The Delivery, Promo
// Code, and Invoice modules' output are exposed today (the concrete
// cases this was built for); extending this to other modules' context
// data is just adding more keys below, not a new mechanism.
export function renderTemplate(template: string, order: Order, context?: WorkflowContext): string {
  const delivery = context?.delivery as DeliveryContextData | undefined;
  const promoCode = context?.["promo-code"] as PromoCodeContextData | undefined;
  const invoice = context?.invoice as InvoiceContextData | undefined;

  const values: Record<string, string> = {
    customer_name: order.customer_name ?? "",
    customer_phone: order.customer_phone ?? "",
    customer_city: order.customer_city ?? "",
    customer_address: order.customer_address ?? "",
    customer_email: order.customer_email ?? "",
    product: order.product ?? "",
    quantity: order.quantity?.toString() ?? "",
    price: order.price?.toString() ?? "",
    order_id: order.order_id ?? String(order.id),
    status: order.status,
    tracking_number: delivery?.trackingNumber ?? "",
    carrier_name: delivery?.carrierName ?? "",
    estimated_delivery: delivery?.estimatedDelivery ?? "",
    promo_code: promoCode?.code ?? "",
    discount_value: promoCode?.discountValue?.toString() ?? "",
    discount_type: promoCode?.discountType ?? "",
    invoice_number: invoice?.invoiceNumber ?? "",
    invoice_amount: invoice?.invoiceAmount?.toString() ?? "",
  };

  return template.replace(/{{\s*(\w+)\s*}}/g, (match, key: string) =>
    key in values ? values[key] : match
  );
}
