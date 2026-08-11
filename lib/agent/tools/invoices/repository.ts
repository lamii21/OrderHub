import { supabase } from "@/lib/supabase";

// Pure Supabase I/O — no decisions here, same rule as every other
// repository.ts in this folder. First repository for the invoices table
// (supabase/schema.sql) — previously only written to, by
// lib/automation-modules/invoice.ts, never read back.
//
// `id` is selected but never returned past service.ts — kept here only so
// the service layer can derive the same human-facing invoice_number
// (`INV-000123`) that invoice.ts already emails to the customer, never as
// a raw Supabase id reaching the model. Same convention every other
// tools/*/repository.ts in this folder already follows.
const INVOICE_COLUMNS = "id, amount, currency, issued_at";

export type InvoiceRow = {
  id: number;
  amount: number;
  currency: string;
  issued_at: string;
};

// No embedded/joined-table filter here (e.g. `.eq("orders.order_id", ...)`)
// — there is no precedent for that pattern anywhere else in this codebase,
// so this resolves the order's internal id first (scoped exactly like
// tools/orders/repository.ts's own findOrderByOrderId), then queries
// invoices by that id. The internal id never leaves this function.
export async function findInvoiceForOrder(
  shopId: number,
  customerId: number,
  orderId: string
): Promise<InvoiceRow | null> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("shop_id", shopId)
    .eq("customer_id", customerId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (orderError) {
    throw new Error(orderError.message);
  }

  if (!order) {
    return null;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("shop_id", shopId)
    .eq("customer_id", customerId)
    .eq("order_id", order.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function findMostRecentInvoiceForCustomer(shopId: number, customerId: number): Promise<InvoiceRow | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("shop_id", shopId)
    .eq("customer_id", customerId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
