// Shared by all 3 platform connectors — originally written once, inline,
// inside lib/platforms/shopify.ts; pulled out here so WooCommerce and
// YouCan (which had no rate-limit handling at all — a gap flagged in an
// earlier audit) get the exact same retry-on-429 behavior instead of a
// second, slightly different reimplementation.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same story as fetchWithRetry above: each connector had its own
// hand-written copy of this exact AbortController/timeout pattern (Node's
// fetch has no default timeout, so a slow/unresponsive store would
// otherwise hang the caller indefinitely). Pulled out once here rather
// than three near-identical ~10-line blocks that would silently drift
// apart the next time one of them needed a fix. WooCommerce passes no
// headers (its auth is query-string based, not a header), which is why
// `init` is a plain RequestInit rather than a headers-only parameter.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  providerName: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${providerName} request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
