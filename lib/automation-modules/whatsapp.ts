import { getModuleCredentials } from "./credentials";
import { renderTemplate } from "./template";
import { fetchWithTimeout, isTimeoutError } from "./http";
import type { AutomationModule } from "./types";

const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

type WhatsAppConfig = { template: string };
type WhatsAppCredentials = { accessToken: string; phoneNumberId: string };

function isWhatsAppCredentials(value: Record<string, unknown> | null): value is WhatsAppCredentials {
  return (
    !!value && typeof value.accessToken === "string" && typeof value.phoneNumberId === "string"
  );
}

// Confirms/informs the customer over WhatsApp — sends a plain text message
// via the WhatsApp Cloud API (Meta's own Business API). Credentials
// (accessToken, phoneNumberId) are per-shop, configured once in
// module_credentials, not re-entered per workflow step.
export const whatsappModule: AutomationModule = {
  validateConfig(config) {
    const { template } = config as Partial<WhatsAppConfig>;

    if (typeof template !== "string" || template.trim() === "") {
      return "WhatsApp requires a non-empty message template.";
    }

    return null;
  },

  async run(order, config) {
    const { template } = config as WhatsAppConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    if (!order.customer_phone) {
      return { success: false, message: "Order has no customer phone number." };
    }

    const credentials = await getModuleCredentials(order.shop_id, "whatsapp");
    if (!isWhatsAppCredentials(credentials)) {
      return { success: false, message: "WhatsApp is not configured for this shop." };
    }

    const message = renderTemplate(template, order);

    try {
      const response = await fetchWithTimeout(`${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: order.customer_phone,
          type: "text",
          text: { body: message },
        }),
      });

      if (!response.ok) {
        return { success: false, message: `WhatsApp API request failed (HTTP ${response.status}).` };
      }

      const body = (await response.json()) as { messages?: { id: string }[] };
      const messageId = body.messages?.[0]?.id;

      return {
        success: true,
        message: "WhatsApp message sent.",
        data: messageId ? { messageId } : undefined,
      };
    } catch (err) {
      console.error("whatsappModule: request failed:", err);
      return {
        success: false,
        message: isTimeoutError(err)
          ? "WhatsApp API request timed out."
          : "WhatsApp API request failed (network error).",
      };
    }
  },
};
