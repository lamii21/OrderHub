import { fetchWithTimeout, isTimeoutError } from "./http";
import { checkUrlSafetySync, assertPublicHttpUrl, UnsafeUrlError } from "@/lib/net-guard";
import type { AutomationModule } from "./types";

const REQUEST_TIMEOUT_MS = 10_000;

// The generic escape hatch — sends the order to any external URL, playing
// the same role for automations that POST /api/orders plays for ingestion:
// a general extension point instead of a dedicated connector per
// integration. Config (url/method/headers) is per-step, not per-shop —
// unlike WhatsApp/Delivery/Email, this module has no fixed "provider" to
// hold credentials for in module_credentials, so any auth it needs is just
// another header in its own config.
type WebhookConfig = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
};

const ALLOWED_METHODS = ["POST", "PUT", "PATCH"];

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export const webhookModule: AutomationModule = {
  validateConfig(config) {
    const { url, method, headers } = config as Partial<WebhookConfig>;

    if (typeof url !== "string" || !isValidUrl(url)) {
      return "Webhook requires a valid http(s) URL.";
    }

    // url is already confirmed parseable with an http(s) protocol above, so
    // this can only fail here on the private-IP/blocked-host checks — a
    // genuinely new rejection, not a reworded version of the check above.
    // Only the synchronous subset of the SSRF check (a literal private IP,
    // not a hostname that merely resolves to one) runs here —
    // validateConfig() is a synchronous contract (see types.ts), so that
    // case can't be caught until run() below, which does the full
    // DNS-resolving check right before the actual request.
    const unsafeReason = checkUrlSafetySync(url);
    if (unsafeReason) {
      return `Webhook URL is not allowed: ${unsafeReason}`;
    }

    if (method !== undefined && !ALLOWED_METHODS.includes(method.toUpperCase())) {
      return `Webhook method must be one of: ${ALLOWED_METHODS.join(", ")}.`;
    }

    if (headers !== undefined && (typeof headers !== "object" || headers === null)) {
      return "Webhook headers must be an object of string values.";
    }

    return null;
  },

  async run(order, config) {
    const { url, method, headers } = config as WebhookConfig;

    try {
      // Full SSRF check, including DNS resolution, right before the
      // request — validateConfig() above only caught the synchronous
      // cases at save time. A config saved before this check existed, or
      // one whose hostname now resolves differently, is still caught here.
      await assertPublicHttpUrl(url);

      const response = await fetchWithTimeout(
        url,
        {
          method: method?.toUpperCase() ?? "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ order, shop: order.shops }),
        },
        REQUEST_TIMEOUT_MS
      );

      const responseBody = await response.text();

      if (!response.ok) {
        return {
          success: false,
          message: `Webhook responded with HTTP ${response.status}.`,
          data: { statusCode: response.status, body: responseBody.slice(0, 500) },
        };
      }

      return {
        success: true,
        message: `Webhook responded with HTTP ${response.status}.`,
        data: { statusCode: response.status, body: responseBody.slice(0, 500) },
      };
    } catch (err) {
      console.error("webhookModule: request failed:", err);
      return {
        success: false,
        message:
          err instanceof UnsafeUrlError
            ? "Webhook URL is not allowed (points at a private or internal address)."
            : isTimeoutError(err)
              ? "Webhook request timed out."
              : "Webhook request failed (network error).",
      };
    }
  },
};
