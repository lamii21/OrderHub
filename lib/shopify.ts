const API_VERSION = "2024-01";
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

function shopifyUrl(storeUrl: string, path: string) {
  const host = storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/admin/api/${API_VERSION}/${path}`;
}

function shopifyHeaders(accessToken: string) {
  return {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Wraps every Shopify request with rate-limit handling: on HTTP 429, wait
// for the duration Shopify itself reports in Retry-After, then retry, up to
// MAX_RETRIES times. Any other status (ok or not) is returned as-is for the
// caller to handle, same as before.
async function fetchShopify(url: string, headers: Record<string, string>): Promise<Response> {
  for (let retry = 0; ; retry++) {
    const response = await fetchWithTimeout(url, headers);

    if (response.status !== 429) {
      return response;
    }

    if (retry >= MAX_RETRIES) {
      throw new Error(`Shopify rate limit exceeded after ${MAX_RETRIES} retries`);
    }

    const retryAfterSeconds = Number(response.headers.get("retry-after")) || 1;
    await sleep(retryAfterSeconds * 1000);
  }
}

function nextPageUrl(response: Response): string | null {
  const link = response.headers.get("link");
  const next = link?.split(",").find((part) => part.includes('rel="next"'));
  const match = next?.match(/<([^>]+)>/);
  return match ? match[1] : null;
}

export async function testShopifyConnection(storeUrl: string, accessToken: string) {
  try {
    const response = await fetchShopify(
      shopifyUrl(storeUrl, "shop.json"),
      shopifyHeaders(accessToken)
    );
    return response.ok;
  } catch {
    return false;
  }
}

export type ShopifyProduct = {
  id: number;
  title: string;
  body_html: string | null;
  variants: { sku: string | null; price: string; inventory_quantity: number | null }[];
};

export async function fetchAllShopifyProducts(storeUrl: string, accessToken: string) {
  const products: ShopifyProduct[] = [];
  let url: string | null = shopifyUrl(storeUrl, "products.json?limit=250");

  while (url) {
    const response: Response = await fetchShopify(url, shopifyHeaders(accessToken));
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    const data: { products: ShopifyProduct[] } = await response.json();
    products.push(...data.products);
    url = nextPageUrl(response);
  }

  return products;
}

export type ShopifyOrder = {
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

export async function fetchNewShopifyOrders(
  storeUrl: string,
  accessToken: string,
  since: string | null
) {
  const orders: ShopifyOrder[] = [];
  const params = new URLSearchParams({ status: "any", limit: "250" });
  if (since) params.set("created_at_min", since);
  let url: string | null = shopifyUrl(storeUrl, `orders.json?${params.toString()}`);

  while (url) {
    const response: Response = await fetchShopify(url, shopifyHeaders(accessToken));
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    const data: { orders: ShopifyOrder[] } = await response.json();
    orders.push(...data.orders);
    url = nextPageUrl(response);
  }

  return orders;
}
