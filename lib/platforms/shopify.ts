import { fetchWithRetry } from "./retry";
import type {
  PlatformConnector,
  PlatformCredentials,
  NormalizedProduct,
  NormalizedOrder,
} from "./types";

const API_VERSION = "2024-01";
const TIMEOUT_MS = 15_000;

function shopifyUrl(storeUrl: string, path: string) {
  const host = storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/admin/api/${API_VERSION}/${path}`;
}

function shopifyHeaders(apiKey: string) {
  return {
    "X-Shopify-Access-Token": apiKey,
    "Content-Type": "application/json",
  };
}

// Node's fetch has no default timeout, so a slow/unresponsive store would
// otherwise hang the server action indefinitely.
async function fetchWithTimeout(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, { headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Shopify request timed out after ${TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// On HTTP 429, wait for the duration Shopify reports in Retry-After, then
// retry — see lib/platforms/retry.ts, shared with WooCommerce/YouCan.
async function fetchShopify(url: string, headers: Record<string, string>): Promise<Response> {
  return fetchWithRetry(() => fetchWithTimeout(url, headers), { providerName: "Shopify" });
}

function nextPageUrl(response: Response): string | null {
  const link = response.headers.get("link");
  const next = link?.split(",").find((part) => part.includes('rel="next"'));
  const match = next?.match(/<([^>]+)>/);
  return match ? match[1] : null;
}

type ShopifyProduct = {
  id: number;
  title: string;
  body_html: string | null;
  variants: { sku: string | null; price: string; inventory_quantity: number | null }[];
};

type ShopifyOrder = {
  id: number;
  created_at: string;
  customer: { first_name: string | null; last_name: string | null; phone: string | null } | null;
  shipping_address: {
    name: string | null;
    address1: string | null;
    city: string | null;
    phone: string | null;
  } | null;
  line_items: { title: string; quantity: number; price: string }[];
};

async function testConnection(credentials: PlatformCredentials): Promise<boolean> {
  try {
    const response = await fetchShopify(
      shopifyUrl(credentials.storeUrl, "shop.json"),
      shopifyHeaders(credentials.apiKey)
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchProducts(credentials: PlatformCredentials): Promise<NormalizedProduct[]> {
  const products: ShopifyProduct[] = [];
  let url: string | null = shopifyUrl(credentials.storeUrl, "products.json?limit=250");

  while (url) {
    const response: Response = await fetchShopify(url, shopifyHeaders(credentials.apiKey));
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    const data: { products: ShopifyProduct[] } = await response.json();
    products.push(...data.products);
    url = nextPageUrl(response);
  }

  // Translating Shopify's shape into the common one is this connector's one
  // real job — nothing downstream ever sees a ShopifyProduct.
  return products.map((product) => {
    const variant = product.variants?.[0];
    return {
      platformProductId: String(product.id),
      name: product.title,
      sku: variant?.sku ?? null,
      description: product.body_html ? product.body_html.replace(/<[^>]*>/g, "").trim() : null,
      price: variant?.price ? Number(variant.price) : null,
      stockQuantity: variant?.inventory_quantity ?? null,
    };
  });
}

async function fetchOrders(
  credentials: PlatformCredentials,
  since: string | null
): Promise<NormalizedOrder[]> {
  const orders: ShopifyOrder[] = [];
  const params = new URLSearchParams({ status: "any", limit: "250" });
  if (since) params.set("created_at_min", since);
  let url: string | null = shopifyUrl(credentials.storeUrl, `orders.json?${params.toString()}`);

  while (url) {
    const response: Response = await fetchShopify(url, shopifyHeaders(credentials.apiKey));
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    const data: { orders: ShopifyOrder[] } = await response.json();
    orders.push(...data.orders);
    url = nextPageUrl(response);
  }

  return orders.map((order) => ({
    createdAt: order.created_at,
    lines: order.line_items.map((item) => ({
      customerName:
        [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ||
        order.shipping_address?.name ||
        "",
      customerPhone: order.customer?.phone ?? order.shipping_address?.phone ?? "",
      customerCity: order.shipping_address?.city ?? "",
      customerAddress: order.shipping_address?.address1 ?? "",
      product: item.title,
      quantity: item.quantity,
      // Shopify's own type has price as a string ("49.50"); normalized it's a
      // number, matching what the webhook's validateOrderPayload requires —
      // sending a string here would have failed validation once the row came
      // back through the Sheet and Apps Script.
      price: Number(item.price),
    })),
  }));
}

export const shopifyConnector: PlatformConnector = {
  testConnection,
  fetchProducts,
  fetchOrders,
};
