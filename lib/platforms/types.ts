// The contract every e-commerce platform connector implements. Keeping it to
// exactly these 3 methods, and having fetchProducts/fetchOrders return
// already-normalized shapes, is what lets syncProducts()/syncOrders()
// (app/shops/connect/actions.ts) stay entirely platform-agnostic — the
// translation from a platform's own API shape happens once, inside its
// connector, never anywhere else.

export type PlatformCredentials = {
  storeUrl: string;
  apiKey: string;
  // Not every platform needs a second secret (Shopify/YouCan don't), but
  // WooCommerce's REST API is authenticated with a Consumer Key + Consumer
  // Secret pair, so this has to exist for connectors that need it.
  apiSecret?: string;
};

export type NormalizedProduct = {
  platformProductId: string;
  name: string;
  sku: string | null;
  description: string | null;
  price: number | null;
  stockQuantity: number | null;
};

export type NormalizedOrderLine = {
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
  product: string;
  quantity: number;
  price: number;
};

export type NormalizedOrder = {
  createdAt: string;
  lines: NormalizedOrderLine[];
};

export interface PlatformConnector {
  testConnection(credentials: PlatformCredentials): Promise<boolean>;
  fetchProducts(credentials: PlatformCredentials): Promise<NormalizedProduct[]>;
  fetchOrders(credentials: PlatformCredentials, since: string | null): Promise<NormalizedOrder[]>;
}
