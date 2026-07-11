import { getModuleCredentials } from "./credentials";
import { fetchWithTimeout, isTimeoutError } from "./http";
import { checkUrlSafetySync, assertPublicHttpUrl, UnsafeUrlError } from "@/lib/net-guard";
import type { AutomationModule } from "./types";

type ErpConfig = { endpoint: string };
type ErpCredentials = { apiKey?: string };

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// Pushes the order to a merchant-configured ERP endpoint — the same
// generic "any provider via one HTTP call" shape as Delivery's
// generic-webhook carrier and the standalone Webhook module, since no
// single named ERP (SAP, Odoo, ...) is connected to this deployment and
// each one's real API differs too much to hard-code one. The endpoint URL
// is per-step config (an ERP integration commonly needs a different
// endpoint per environment or workflow); an optional API key lives in
// module_credentials, same split as Delivery's carrier credentials.
export const erpModule: AutomationModule = {
  validateConfig(config) {
    const { endpoint } = config as Partial<ErpConfig>;

    if (typeof endpoint !== "string" || !isValidUrl(endpoint)) {
      return "ERP requires a valid endpoint URL.";
    }

    // Only the synchronous subset of the SSRF check runs here (see
    // net-guard.ts) — the full DNS-resolving check happens in run(), right
    // before the request.
    const unsafeReason = checkUrlSafetySync(endpoint);
    if (unsafeReason) {
      return `ERP endpoint is not allowed: ${unsafeReason}`;
    }

    return null;
  },

  async run(order, config) {
    const { endpoint } = config as ErpConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    const credentials = (await getModuleCredentials(order.shop_id, "erp")) as ErpCredentials | null;

    try {
      await assertPublicHttpUrl(endpoint);

      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(credentials?.apiKey && { Authorization: `Bearer ${credentials.apiKey}` }),
        },
        body: JSON.stringify({
          order_id: order.id,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          customer_email: order.customer_email,
          customer_city: order.customer_city,
          customer_address: order.customer_address,
          product: order.product,
          quantity: order.quantity,
          price: order.price,
          status: order.status,
        }),
      });

      if (!response.ok) {
        return { success: false, message: `ERP request failed (HTTP ${response.status}).` };
      }

      const responseBody = (await response.json().catch(() => ({}))) as { record_id?: string };

      return {
        success: true,
        message: "Order pushed to ERP.",
        data: responseBody.record_id ? { erpRecordId: responseBody.record_id } : undefined,
      };
    } catch (err) {
      console.error("erpModule: request failed:", err);
      return {
        success: false,
        message:
          err instanceof UnsafeUrlError
            ? "ERP endpoint is not allowed (points at a private or internal address)."
            : isTimeoutError(err)
              ? "ERP request timed out."
              : "ERP request failed (network error).",
      };
    }
  },
};
