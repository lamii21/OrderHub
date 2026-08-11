import { findInvoiceForOrder, findMostRecentInvoiceForCustomer, type InvoiceRow } from "./repository";

export type InvoiceForCustomer = {
  invoice_number: string;
  amount: number;
  currency: string;
  issued_at: string;
};

export type InvoiceResult = { found: true; invoice: InvoiceForCustomer } | { found: false };

// Same `INV-${padded id}` format as lib/automation-modules/invoice.ts's own
// renderInvoiceHtml() email — a customer asking the agent about an invoice
// they already received by email must see the same number, not a
// different-looking identifier for the same row.
function toInvoiceForCustomer(row: InvoiceRow): InvoiceForCustomer {
  return {
    invoice_number: `INV-${String(row.id).padStart(6, "0")}`,
    amount: row.amount,
    currency: row.currency,
    issued_at: row.issued_at,
  };
}

// customerId required, not optional — same reasoning as
// tools/orders/service.ts's getOrderStatusForCustomer and
// tools/customers/service.ts's getCustomerStatsForCustomer.
export async function getInvoiceForCustomer(
  shopId: number,
  customerId: number,
  orderId?: string
): Promise<InvoiceResult> {
  const invoice = orderId
    ? await findInvoiceForOrder(shopId, customerId, orderId)
    : await findMostRecentInvoiceForCustomer(shopId, customerId);

  return invoice ? { found: true, invoice: toInvoiceForCustomer(invoice) } : { found: false };
}
