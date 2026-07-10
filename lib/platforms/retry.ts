// Shared by all 3 platform connectors — originally written once, inline,
// inside lib/platforms/shopify.ts; pulled out here so WooCommerce and
// YouCan (which had no rate-limit handling at all — a gap flagged in an
// earlier audit) get the exact same retry-on-429 behavior instead of a
// second, slightly different reimplementation.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `fetcher` is called fresh on every attempt (never reused) so each retry
// gets its own AbortController/timeout via the connector's own
// fetchWithTimeout — this function only decides *whether* to retry, never
// how the request itself is made.
export async function fetchWithRetry(
  fetcher: () => Promise<Response>,
  { providerName, maxRetries = 3 }: { providerName: string; maxRetries?: number }
): Promise<Response> {
  for (let retry = 0; ; retry++) {
    const response = await fetcher();

    if (response.status !== 429) {
      return response;
    }

    if (retry >= maxRetries) {
      throw new Error(`${providerName} rate limit exceeded after ${maxRetries} retries`);
    }

    const retryAfterSeconds = Number(response.headers.get("retry-after")) || 1;
    await sleep(retryAfterSeconds * 1000);
  }
}
