import { getModuleCredentials } from "./credentials";
import { fetchWithTimeout, isTimeoutError } from "./http";
import { checkUrlSafetySync, assertPublicHttpUrl, UnsafeUrlError } from "@/lib/net-guard";
import type { AutomationModule } from "./types";

type CrmConfig = { provider: string; endpoint: string };
type CrmCredentials = { apiKey?: string };

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// Pushes the order to a merchant-configured CRM endpoint — same generic
// "any provider via one HTTP call" shape as ERP/Delivery's generic-webhook
// carrier, since HubSpot/Salesforce/Pipedrive/Zoho each have their own
// unrelated auth flow and API shape and no single one is connected to this
// deployment. `provider` stays a required, freeform label purely for
// display/logging (workflow history, error messages) — the module itself
// never branches on it; `endpoint` is what actually gets called, typically
// a webhook step in the CRM's own automation product (Zapier/Make, or a
// native "incoming webhook" feature most CRMs already offer) rather than
// the CRM's raw REST API. An optional API key lives in module_credentials,
// same split as Delivery/ERP.
export const crmModule: AutomationModule = {
  validateConfig(config) {
    const { provider, endpoint } = config as Partial<CrmConfig>;

    if (typeof provider !== "string" || provider.trim() === "") {
      return "CRM requires a provider name.";
    }

    if (typeof endpoint !== "string" || !isValidUrl(endpoint)) {
      return "CRM requires a valid endpoint URL.";
    }

    // Only the synchronous subset of the SSRF check runs here (see
    // net-guard.ts) — the full DNS-resolving check happens in run(), right
    // before the request.
    const unsafeReason = checkUrlSafetySync(endpoint);
    if (unsafeReason) {
      return `CRM endpoint is not allowed: ${unsafeReason}`;
    }

    return null;
  },

  async run(order, config) {
    const { provider, endpoint } = config as CrmConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    const credentials = (await getModuleCredentials(order.shop_id, "crm")) as CrmCredentials | null;

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
        return { success: false, message: `CRM request failed (HTTP ${response.status}).` };
      }

      const responseBody = (await response.json().catch(() => ({}))) as { record_id?: string };

      return {
        success: true,
        message: `Order pushed to ${provider}.`,
        data: responseBody.record_id ? { crmRecordId: responseBody.record_id } : undefined,
      };
    } catch (err) {
      console.error("crmModule: request failed:", err);
      return {
        success: false,
        message:
          err instanceof UnsafeUrlError
            ? "CRM endpoint is not allowed (points at a private or internal address)."
            : isTimeoutError(err)
              ? "CRM request timed out."
              : "CRM request failed (network error).",
      };
    }
  },
};
