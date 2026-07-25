import { supabase } from "@/lib/supabase";
import { getModuleCredentials } from "./credentials";
import { fetchWithTimeout, isTimeoutError } from "./http";
import type { AutomationModule } from "./types";

const RESEND_API_URL = "https://api.resend.com/emails";

type InvoiceConfig = { footerNote?: string };
type EmailCredentials = { apiKey: string; fromAddress: string };

function isEmailCredentials(value: Record<string, unknown> | null): value is EmailCredentials {
  return !!value && typeof value.apiKey === "string" && typeof value.fromAddress === "string";
}

// Self-contained rather than "generate the invoice, then a separate Email
// step sends it": the shared Email module's renderTemplate() only ever
// produces a plain-text body (see email.ts — it sends `text`, never
// `html`, to Resend), so a structured invoice layout can't be expressed
// through that path without changing what the Email module itself does.
// Sending here directly — same Resend credentials (module_credentials,
// "email"), same provider — keeps this one module independently
// reasoned-about, mirroring how the Delivery module makes its own HTTP
// call rather than requiring a separate "send via Webhook" step after it.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInvoiceHtml(params: {
  invoiceNumber: string;
  shopName: string;
  issuedAt: string;
  customerName: string;
  customerAddress: string;
  product: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: string;
  footerNote?: string;
}): string {
  const {
    invoiceNumber,
    shopName,
    issuedAt,
    customerName,
    customerAddress,
    product,
    quantity,
    unitPrice,
    total,
    currency,
    footerNote,
  } = params;

  return `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
      <h1 style="font-size: 20px;">${escapeHtml(shopName)}</h1>
      <p style="color: #555;">Invoice ${escapeHtml(invoiceNumber)} — ${escapeHtml(issuedAt)}</p>
      <p><strong>Bill to:</strong><br>${escapeHtml(customerName)}<br>${escapeHtml(customerAddress)}</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <thead>
          <tr style="border-bottom: 1px solid #ddd; text-align: left;">
            <th style="padding: 8px 0;">Product</th>
            <th style="padding: 8px 0;">Qty</th>
            <th style="padding: 8px 0;">Unit price</th>
            <th style="padding: 8px 0;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 8px 0;">${escapeHtml(product)}</td>
            <td style="padding: 8px 0;">${quantity}</td>
            <td style="padding: 8px 0;">${unitPrice.toFixed(2)} ${escapeHtml(currency)}</td>
            <td style="padding: 8px 0;">${total.toFixed(2)} ${escapeHtml(currency)}</td>
          </tr>
        </tbody>
      </table>
      <p style="text-align: right; font-weight: bold; margin-top: 8px;">
        Total: ${total.toFixed(2)} ${escapeHtml(currency)}
      </p>
      ${footerNote ? `<p style="color: #555; margin-top: 24px;">${escapeHtml(footerNote)}</p>` : ""}
    </div>
  `.trim();
}

// Generates an invoice record and emails it as a structured HTML message
// — see this table's own comment in supabase/schema.sql for why the
// invoice number is derived from the row's identity column rather than a
// separate per-shop counter. The invoice record is written before the
// email is attempted and is never rolled back if sending fails: an
// invoice that was issued but not yet successfully delivered is still a
// real invoice, same "the write is authoritative, delivery is a
// downstream best-effort concern" posture as an order and its
// order.created dispatch.
export const invoiceModule: AutomationModule = {
  validateConfig(config) {
    const { footerNote } = config as Partial<InvoiceConfig>;

    if (footerNote !== undefined && (typeof footerNote !== "string" || footerNote.length > 500)) {
      return "footerNote, when provided, must be a string of at most 500 characters.";
    }

    return null;
  },

  async run(order, config) {
    const { footerNote } = config as InvoiceConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    if (!order.customer_email) {
      return { success: false, message: "Order has no customer email address." };
    }

    if (order.price === null || order.quantity === null) {
      return { success: false, message: "Order is missing a price or quantity." };
    }

    const credentials = await getModuleCredentials(order.shop_id, "email");
    if (!isEmailCredentials(credentials)) {
      return { success: false, message: "Email is not configured for this shop." };
    }

    const { data: shop } = await supabase
      .from("shops")
      .select("name, currency")
      .eq("id", order.shop_id)
      .maybeSingle();

    const total = order.price * order.quantity;

    const { data: invoiceRow, error: insertError } = await supabase
      .from("invoices")
      .insert({
        shop_id: order.shop_id,
        order_id: order.id,
        customer_id: order.customer_id,
        amount: total,
        currency: shop?.currency ?? "USD",
      })
      .select("id")
      .single();

    if (insertError || !invoiceRow) {
      console.error("invoiceModule: failed to create invoice record:", insertError);
      return { success: false, message: "Could not create the invoice." };
    }

    const invoiceNumber = `INV-${String(invoiceRow.id).padStart(6, "0")}`;

    const html = renderInvoiceHtml({
      invoiceNumber,
      shopName: shop?.name ?? "",
      issuedAt: new Date().toISOString().slice(0, 10),
      customerName: order.customer_name ?? "",
      customerAddress: [order.customer_address, order.customer_city].filter(Boolean).join(", "),
      product: order.product ?? "",
      quantity: order.quantity,
      unitPrice: order.price,
      total,
      currency: shop?.currency ?? "USD",
      footerNote,
    });

    try {
      const response = await fetchWithTimeout(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: credentials.fromAddress,
          to: order.customer_email,
          subject: `Invoice ${invoiceNumber}`,
          html,
        }),
      });

      if (!response.ok) {
        return { success: false, message: `Invoice email failed (HTTP ${response.status}).` };
      }

      return {
        success: true,
        message: `Invoice ${invoiceNumber} sent.`,
        data: { invoiceNumber, invoiceAmount: total },
      };
    } catch (err) {
      console.error("invoiceModule: request failed:", err);
      return {
        success: false,
        message: isTimeoutError(err)
          ? "Invoice email timed out."
          : "Invoice email failed (network error).",
      };
    }
  },
};
