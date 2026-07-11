import { fetchWithRetry, fetchWithTimeout } from "./retry";
import { assertPublicHttpUrl } from "@/lib/net-guard";
import type {
  PlatformConnector,
  PlatformCredentials,
  NormalizedProduct,
  NormalizedOrder,
} from "./types";

const API_BASE = "wp-json/wc/v3";
const PER_PAGE = 100;
const TIMEOUT_MS = 15_000;

function wooUrl(
  storeUrl: string,
  path: string,
  params: URLSearchParams,
  credentials: PlatformCredentials
) {
  const host = storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // WooCommerce's REST API authenticates via Consumer Key + Consumer Secret
  // as query params (fine over HTTPS) rather than a single bearer token —
  // the one connector that actually needs PlatformCredentials.apiSecret.
  params.set("consumer_key", credentials.apiKey);
  params.set("consumer_secret", credentials.apiSecret ?? "");
  return `https://${host}/${API_BASE}/${path}?${params.toString()}`;
}

// On HTTP 429, wait for Retry-After then retry — WooCommerce previously had
// no rate-limit handling at all (flagged in an earlier audit as an
// asymmetry with the Shopify connector); see lib/platforms/retry.ts,
// shared across all 3 connectors.
//
// Same SSRF guard as the Shopify/YouCan connectors — see shopify.ts's
// fetchShopify() for the full reasoning. No headers needed here (unlike
// Shopify/YouCan): WooCommerce's auth is already baked into the URL by
// wooUrl() above.
async function fetchWooCommerce(url: string): Promise<Response> {
  await assertPublicHttpUrl(url);
  return fetchWithRetry(() => fetchWithTimeout(url, {}, TIMEOUT_MS, "WooCommerce"), {
    providerName: "WooCommerce",
  });
}

function nextPageUrl(response: Response): string | null {
  const link = response.headers.get("link");
  const next = link?.split(",").find((part) => part.includes('rel="next"'));
  const match = next?.match(/<([^>]+)>/);
  return match ? match[1] : null;
}

type WooProduct = {
  id: number;
  name: string;
  sku: string | null;
  description: string | null;
  price: string;
  stock_quantity: number | null;
};

type WooOrder = {
  id: number;
  // WooCommerce also exposes date_created_gmt; using the gmt field keeps
  // the incremental-sync cursor unambiguous (site-local date_created has no
  // offset marker, so comparing it across stores in different timezones
  // would be a footgun).
  date_created_gmt: string;
  billing: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    address_1: string | null;
    city: string | null;
  };
  line_items: { name: string; quantity: number; price: string }[];
};

async function testConnection(credentials: PlatformCredentials): Promise<boolean> {
  try {
    const url = wooUrl(
      credentials.storeUrl,
      "products",
      new URLSearchParams({ per_page: "1" }),
      credentials
    );
    const response = await fetchWooCommerce(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchProducts(credentials: PlatformCredentials): Promise<NormalizedProduct[]> {
  const products: WooProduct[] = [];
  let url: string | null = wooUrl(
    credentials.storeUrl,
    "products",
    new URLSearchParams({ per_page: String(PER_PAGE) }),
    credentials
  );

  while (url) {
    const response: Response = await fetchWooCommerce(url);
    if (!response.ok) {
      throw new Error(`WooCommerce API error: ${response.status}`);
    }
    const data: WooProduct[] = await response.json();
    products.push(...data);
    url = nextPageUrl(response);
  }

  return products.map((product) => ({
    platformProductId: String(product.id),
    name: product.name,
    sku: product.sku || null,
    description: product.description ? product.description.replace(/<[^>]*>/g, "").trim() : null,
    price: product.price ? Number(product.price) : null,
    stockQuantity: product.stock_quantity,
  }));
}

async function fetchOrders(
  credentials: PlatformCredentials,
  since: string | null
): Promise<NormalizedOrder[]> {
  const orders: WooOrder[] = [];
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    orderby: "date",
    order: "asc",
  });
  if (since) params.set("after", since);
  let url: string | null = wooUrl(credentials.storeUrl, "orders", params, credentials);

  while (url) {
    const response: Response = await fetchWooCommerce(url);
    if (!response.ok) {
      throw new Error(`WooCommerce API error: ${response.status}`);
    }
    const data: WooOrder[] = await response.json();
    orders.push(...data);
    url = nextPageUrl(response);
  }

  return orders.map((order) => ({
    createdAt: order.date_created_gmt,
    lines: order.line_items.map((item) => ({
      customerName: [order.billing.first_name, order.billing.last_name]
        .filter(Boolean)
        .join(" "),
      customerPhone: order.billing.phone ?? "",
      customerCity: order.billing.city ?? "",
      customerAddress: order.billing.address_1 ?? "",
      product: item.name,
      quantity: item.quantity,
      price: Number(item.price),
    })),
  }));
}

export const woocommerceConnector: PlatformConnector = {
  testConnection,
  fetchProducts,
  fetchOrders,
};
