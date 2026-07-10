import type { Order } from "@/types/order";

// A fixed, whitelisted set of {{variable}} substitutions — deliberately not
// a general templating engine (no loops, no expressions, no eval). Shared
// by every module that sends a merchant-authored message (WhatsApp, Email,
// Notes) so the variable vocabulary stays identical across all of them.
// Unknown variables are left as-is rather than throwing, so a typo in a
// template degrades to visibly-wrong text instead of a failed step.
export function renderTemplate(template: string, order: Order): string {
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
  };

  return template.replace(/{{\s*(\w+)\s*}}/g, (match, key: string) =>
    key in values ? values[key] : match
  );
}
