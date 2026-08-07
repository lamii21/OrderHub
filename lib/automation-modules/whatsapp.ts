import { getModuleCredentials } from "./credentials";
import { renderTemplate } from "./template";
import { isTimeoutError } from "./http";
import { sendWhatsAppTextMessage, isWhatsAppCredentials, WhatsAppApiError } from "@/lib/whatsapp-client";
import type { AutomationModule } from "./types";

type WhatsAppConfig = { template: string };

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

  async run(order, config, context) {
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

    const message = renderTemplate(template, order, context);

    try {
      const { messageId } = await sendWhatsAppTextMessage(credentials, order.customer_phone, message);

      return {
        success: true,
        message: "WhatsApp message sent.",
        data: messageId ? { messageId } : undefined,
      };
    } catch (err) {
      console.error("whatsappModule: request failed:", err);

      if (err instanceof WhatsAppApiError) {
        return { success: false, message: err.message };
      }

      return {
        success: false,
        message: isTimeoutError(err)
          ? "WhatsApp API request timed out."
          : "WhatsApp API request failed (network error).",
      };
    }
  },
};
