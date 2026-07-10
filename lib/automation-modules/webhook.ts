import { fetchWithTimeout, isTimeoutError } from "./http";
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
        message: isTimeoutError(err) ? "Webhook request timed out." : "Webhook request failed (network error).",
      };
    }
  },
};
