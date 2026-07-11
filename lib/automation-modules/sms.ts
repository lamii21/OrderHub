import { getModuleCredentials } from "./credentials";
import { renderTemplate } from "./template";
import { fetchWithTimeout, isTimeoutError } from "./http";
import type { AutomationModule } from "./types";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

type SmsConfig = { template: string };
type SmsCredentials = { accountSid: string; authToken: string; fromNumber: string };

function isSmsCredentials(value: Record<string, unknown> | null): value is SmsCredentials {
  return (
    !!value &&
    typeof value.accountSid === "string" &&
    typeof value.authToken === "string" &&
    typeof value.fromNumber === "string"
  );
}

// Sends a plain-text SMS via Twilio's Messages resource — same shape as
// WhatsApp (per-shop credentials in module_credentials, a rendered
// template, one REST call), just swapping the WhatsApp Cloud API for
// Twilio, the standard choice absent a specific provider requirement.
export const smsModule: AutomationModule = {
  validateConfig(config) {
    const { template } = config as Partial<SmsConfig>;

    if (typeof template !== "string" || template.trim() === "") {
      return "SMS requires a non-empty message template.";
    }

    return null;
  },

  async run(order, config) {
    const { template } = config as SmsConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    if (!order.customer_phone) {
      return { success: false, message: "Order has no customer phone number." };
    }

    const credentials = await getModuleCredentials(order.shop_id, "sms");
    if (!isSmsCredentials(credentials)) {
      return { success: false, message: "SMS is not configured for this shop." };
    }

    const message = renderTemplate(template, order);

    try {
      const body = new URLSearchParams({
        To: order.customer_phone,
        From: credentials.fromNumber,
        Body: message,
      });

      const response = await fetchWithTimeout(
        `${TWILIO_API_BASE}/Accounts/${credentials.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${credentials.accountSid}:${credentials.authToken}`
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        }
      );

      if (!response.ok) {
        return { success: false, message: `SMS request failed (HTTP ${response.status}).` };
      }

      const responseBody = (await response.json().catch(() => ({}))) as { sid?: string };

      return {
        success: true,
        message: "SMS sent.",
        data: responseBody.sid ? { messageSid: responseBody.sid } : undefined,
      };
    } catch (err) {
      console.error("smsModule: request failed:", err);
      return {
        success: false,
        message: isTimeoutError(err)
          ? "SMS request timed out."
          : "SMS request failed (network error).",
      };
    }
  },
};
