import type { PlatformConnector } from "./types";
import { shopifyConnector } from "./shopify";
import { youcanConnector } from "./youcan";
import { woocommerceConnector } from "./woocommerce";

// The one and only place a platform name maps to actual code. Adding a new
// platform means writing lib/platforms/<name>.ts and adding one line here —
// nothing else in the app ever branches on a platform name.
const connectors: Record<string, PlatformConnector> = {
  Shopify: shopifyConnector,
  YouCan: youcanConnector,
  WooCommerce: woocommerceConnector,
};

export function getConnector(platform: string): PlatformConnector {
  const connector = connectors[platform];

  if (!connector) {
    throw new Error(`No connector registered for platform "${platform}"`);
  }

  return connector;
}

// Single source of truth for which platforms the Connect Store form is
// allowed to offer — reused for both the <select> options and validating
// the submitted platform, so the two can never drift apart.
export const SUPPORTED_PLATFORMS = Object.keys(connectors);

export type {
  PlatformConnector,
  PlatformCredentials,
  NormalizedProduct,
  NormalizedOrder,
  NormalizedOrderLine,
} from "./types";
