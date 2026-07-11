import { fetchWithRetry, fetchWithTimeout } from "./retry";
import { assertPublicHttpUrl } from "@/lib/net-guard";
import type {
  PlatformConnector,
  PlatformCredentials,
  NormalizedProduct,
  NormalizedOrder,
} from "./types";

// UNVERIFIED CONNECTOR. Unlike the Shopify and WooCommerce connectors —
// cross-checked against well-documented, stable public REST APIs — this one
// is a best-effort structural implementation based on general recollection
// of YouCan's API shape, not confirmed against real developer docs or a
// live store. The endpoint paths, field names, pagination style, and auth
// header below are all reasonable guesses, not verified facts.
//
// Before relying on this: connect a real YouCan store via /shops/connect,
// hit "Test Connection", and check what actually comes back. The most
// likely things to need adjusting, in order: the base path (currently
// assumed "/api/v1/"), the auth header (currently "Bearer <apiKey>"), and
// the product/order field names below.

const TIMEOUT_MS = 15_000;

function youcanUrl(storeUrl: string, path: string) {
  const host = storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/api/v1/${path}`;
}

function youcanHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// On HTTP 429, wait for Retry-After then retry — same gap-closing reasoning
// as WooCommerce; see lib/platforms/retry.ts. Same SSRF guard as the other
// two connectors — see shopify.ts's fetchShopify() for the full reasoning.
async function fetchYouCan(url: string, headers: Record<string, string>): Promise<Response> {
  await assertPublicHttpUrl(url);
  return fetchWithRetry(() => fetchWithTimeout(url, { headers }, TIMEOUT_MS, "YouCan"), {
    providerName: "YouCan",
  });
}

type YouCanProduct = {
  id: number | string;
  title: string;
  sku: string | null;
  description: string | null;
  price: number | string | null;
  quantity: number | null;
};

type YouCanOrder = {
  id: number | string;
  created_at: string;
  customer: { full_name: string | null; phone: string | null } | null;
  address: { city: string | null; address: string | null } | null;
  items: { title: string; quantity: number; price: number | string }[];
};

async function testConnection(credentials: PlatformCredentials): Promise<boolean> {
  try {
    const response = await fetchYouCan(
      youcanUrl(credentials.storeUrl, "products?limit=1"),
      youcanHeaders(credentials.apiKey)
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchProducts(credentials: PlatformCredentials): Promise<NormalizedProduct[]> {
  const products: YouCanProduct[] = [];
  const limit = 100;
  let page = 1;

  // Assumes page/limit pagination that ends on a short (or empty) page —
  // if YouCan instead returns a { data, meta } envelope or a Link header
  // like Shopify's, this loop is the first place to fix.
  for (;;) {
    const response = await fetchYouCan(
      youcanUrl(credentials.storeUrl, `products?page=${page}&limit=${limit}`),
      youcanHeaders(credentials.apiKey)
    );
    if (!response.ok) {
      throw new Error(`YouCan API error: ${response.status}`);
    }
    const data: YouCanProduct[] = await response.json();
    products.push(...data);
    if (data.length < limit) break;
    page++;
  }

  return products.map((product) => ({
    platformProductId: String(product.id),
    name: product.title,
    sku: product.sku ?? null,
    description: product.description ?? null,
    price: product.price !== null ? Number(product.price) : null,
    stockQuantity: product.quantity ?? null,
  }));
}

async function fetchOrders(
  credentials: PlatformCredentials,
  since: string | null
): Promise<NormalizedOrder[]> {
  const orders: YouCanOrder[] = [];
  const limit = 100;
  let page = 1;

  for (;;) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (since) params.set("created_after", since);
    const response = await fetchYouCan(
      youcanUrl(credentials.storeUrl, `orders?${params.toString()}`),
      youcanHeaders(credentials.apiKey)
    );
    if (!response.ok) {
      throw new Error(`YouCan API error: ${response.status}`);
    }
    const data: YouCanOrder[] = await response.json();
    orders.push(...data);
    if (data.length < limit) break;
    page++;
  }

  return orders.map((order) => ({
    createdAt: order.created_at,
    lines: order.items.map((item) => ({
      customerName: order.customer?.full_name ?? "",
      customerPhone: order.customer?.phone ?? "",
      customerCity: order.address?.city ?? "",
      customerAddress: order.address?.address ?? "",
      product: item.title,
      quantity: item.quantity,
      price: Number(item.price),
    })),
  }));
}

export const youcanConnector: PlatformConnector = {
  testConnection,
  fetchProducts,
  fetchOrders,
};
