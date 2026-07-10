import { getModuleCredentials } from "./credentials";
import { renderTemplate } from "./template";
import { fetchWithTimeout, isTimeoutError } from "./http";
import type { AutomationModule } from "./types";

const RESEND_API_URL = "https://api.resend.com/emails";

type EmailConfig = { subject: string; body: string };
type EmailCredentials = { apiKey: string; fromAddress: string };

function isEmailCredentials(value: Record<string, unknown> | null): value is EmailCredentials {
  return !!value && typeof value.apiKey === "string" && typeof value.fromAddress === "string";
}

// Sends a transactional email (confirmation, invoice, shipping notice) via
// Resend — a single REST endpoint, no SDK dependency needed. Credentials
// (apiKey, fromAddress) are per-shop, in module_credentials, same as
// WhatsApp/Delivery.
export const emailModule: AutomationModule = {
  validateConfig(config) {
    const { subject, body } = config as Partial<EmailConfig>;

    if (typeof subject !== "string" || subject.trim() === "") {
      return "Email requires a non-empty subject.";
    }

    if (typeof body !== "string" || body.trim() === "") {
      return "Email requires a non-empty body.";
    }

    return null;
  },

  async run(order, config) {
    const { subject, body } = config as EmailConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    // customer_email is nullable — most orders today arrive without one
    // (the Google Sheets ingestion pipeline has never collected it), so a
    // missing address is an expected, common failure, not a bug.
    if (!order.customer_email) {
      return { success: false, message: "Order has no customer email address." };
    }

    const credentials = await getModuleCredentials(order.shop_id, "email");
    if (!isEmailCredentials(credentials)) {
      return { success: false, message: "Email is not configured for this shop." };
    }

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
          subject: renderTemplate(subject, order),
          text: renderTemplate(body, order),
        }),
      });

      if (!response.ok) {
        return { success: false, message: `Email request failed (HTTP ${response.status}).` };
      }

      const responseBody = (await response.json().catch(() => ({}))) as { id?: string };

      return {
        success: true,
        message: "Email sent.",
        data: responseBody.id ? { messageId: responseBody.id } : undefined,
      };
    } catch (err) {
      console.error("emailModule: request failed:", err);
      return {
        success: false,
        message: isTimeoutError(err) ? "Email request timed out." : "Email request failed (network error).",
      };
    }
  },
};
