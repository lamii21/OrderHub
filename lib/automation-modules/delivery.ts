import { getModuleCredentials } from "./credentials";
import { fetchWithTimeout, isTimeoutError } from "./http";
import { assertPublicHttpUrl, UnsafeUrlError } from "@/lib/net-guard";
import type { AutomationModule, ModuleResult } from "./types";
import type { Order } from "@/types/order";

type DeliveryConfig = { carrier: string };
type DeliveryCredentials = { webhookUrl: string; apiKey?: string };

// A small internal sub-registry — same getConnector() pattern as
// lib/platforms/index.ts, applied a second time inside a single module
// file rather than at the top-level registry, per the Automation Modules
// catalog's own guidance for modules that cover several providers. Only
// one entry exists today (no real carrier account is connected yet): a
// generic outbound webhook, so a shop can point this at whatever shipping
// integration it already has. Adding a real named carrier later is one
// more entry here — the module's own run() below never changes.
type DeliveryCarrier = {
  createShipment(order: Order, credentials: Record<string, unknown>): Promise<ModuleResult>;
};

function isDeliveryCredentials(
  value: Record<string, unknown> | null
): value is DeliveryCredentials {
  return !!value && typeof value.webhookUrl === "string";
}

const carriers: Record<string, DeliveryCarrier> = {
  "generic-webhook": {
    async createShipment(order, rawCredentials) {
      if (!isDeliveryCredentials(rawCredentials)) {
        return { success: false, message: "Delivery is not configured for this shop." };
      }

      try {
        // module_credentials has no Server Action that writes it yet (rows
        // are provisioned by hand — see credentials.ts), so there's no
        // config-save moment to validate this URL at; this run-time check,
        // including DNS resolution, is the only enforcement point.
        await assertPublicHttpUrl(rawCredentials.webhookUrl);

        const response = await fetchWithTimeout(rawCredentials.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(rawCredentials.apiKey && { Authorization: `Bearer ${rawCredentials.apiKey}` }),
          },
          body: JSON.stringify({
            order_id: order.id,
            customer_name: order.customer_name,
            customer_phone: order.customer_phone,
            customer_city: order.customer_city,
            customer_address: order.customer_address,
            product: order.product,
            quantity: order.quantity,
          }),
        });

        if (!response.ok) {
          return { success: false, message: `Delivery request failed (HTTP ${response.status}).` };
        }

        const body = (await response.json().catch(() => ({}))) as {
          tracking_number?: string;
          carrier_name?: string;
          estimated_delivery?: string;
        };

        return {
          success: true,
          message: "Shipment created.",
          data: {
            trackingNumber: body.tracking_number,
            carrierName: body.carrier_name ?? "generic-webhook",
            estimatedDelivery: body.estimated_delivery,
          },
        };
      } catch (err) {
        console.error("deliveryModule: generic-webhook request failed:", err);
        return {
          success: false,
          message:
            err instanceof UnsafeUrlError
              ? "Delivery webhook URL is not allowed (points at a private or internal address)."
              : isTimeoutError(err)
                ? "Delivery request timed out."
                : "Delivery request failed (network error).",
        };
      }
    },
  },
};

// Creates a shipment with a carrier and returns its tracking number.
export const deliveryModule: AutomationModule = {
  validateConfig(config) {
    const { carrier } = config as Partial<DeliveryConfig>;

    if (typeof carrier !== "string" || !(carrier in carriers)) {
      return `Delivery requires a valid carrier (one of: ${Object.keys(carriers).join(", ")}).`;
    }

    return null;
  },

  async run(order, config) {
    const { carrier } = config as DeliveryConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    if (!order.customer_address || !order.customer_city) {
      return { success: false, message: "Order is missing a delivery address or city." };
    }

    const carrierImpl = carriers[carrier];
    if (!carrierImpl) {
      return { success: false, message: `Unknown delivery carrier "${carrier}".` };
    }

    const credentials = await getModuleCredentials(order.shop_id, "delivery");
    return carrierImpl.createShipment(order, credentials ?? {});
  },
};
