import { fetchWithTimeout, isTimeoutError } from "./http";
import { checkUrlSafetySync, assertPublicHttpUrl, UnsafeUrlError } from "@/lib/net-guard";
import { renderTemplate } from "./template";
import type { AutomationModule } from "./types";

// Posts to a Slack incoming webhook — config is per-step (the webhook URL
// already encodes which workspace/channel it posts to), not per-shop, same
// reasoning as the generic Webhook module rather than WhatsApp/Email's
// module_credentials pattern. Reuses the same SSRF guard as
// Webhook/Delivery: a merchant-supplied URL is still merchant-supplied,
// whether or not "Slack" is in the field name.
type SlackConfig = { webhookUrl: string; template?: string };

const DEFAULT_TEMPLATE =
  "New order #{{order_id}} from {{customer_name}} — {{product}} ({{status}}).";

function isValidHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export const slackModule: AutomationModule = {
  validateConfig(config) {
    const { webhookUrl, template } = config as Partial<SlackConfig>;

    if (typeof webhookUrl !== "string" || !isValidHttpsUrl(webhookUrl)) {
      return "Slack requires a valid https webhook URL.";
    }

    // Same reasoning as webhook.ts: the URL is already confirmed parseable
    // https above, so this can only newly reject on the private-IP/blocked-
    // host checks. Only the synchronous subset runs here — the full
    // DNS-resolving check happens in run(), right before the request.
    const unsafeReason = checkUrlSafetySync(webhookUrl);
    if (unsafeReason) {
      return `Slack webhook URL is not allowed: ${unsafeReason}`;
    }

    if (template !== undefined && (typeof template !== "string" || template.trim() === "")) {
      return "Slack template, when provided, must be a non-empty string.";
    }

    return null;
  },

  async run(order, config) {
    const { webhookUrl, template } = config as SlackConfig;

    try {
      // Full SSRF check, including DNS resolution, right before the
      // request — validateConfig() above only caught the synchronous
      // cases at save time.
      await assertPublicHttpUrl(webhookUrl);

      const text = renderTemplate(template ?? DEFAULT_TEMPLATE, order);

      const response = await fetchWithTimeout(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const responseBody = await response.text();

      if (!response.ok) {
        return {
          success: false,
          message: `Slack responded with HTTP ${response.status}.`,
          data: { statusCode: response.status, body: responseBody.slice(0, 500) },
        };
      }

      return { success: true, message: "Slack message sent." };
    } catch (err) {
      console.error("slackModule: request failed:", err);
      return {
        success: false,
        message:
          err instanceof UnsafeUrlError
            ? "Slack webhook URL is not allowed (points at a private or internal address)."
            : isTimeoutError(err)
              ? "Slack request timed out."
              : "Slack request failed (network error).",
      };
    }
  },
};
