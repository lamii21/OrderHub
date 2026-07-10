const DEFAULT_TIMEOUT_MS = 10_000;

// Shared by every module that calls an external HTTP API (WhatsApp, Email,
// Delivery, Webhook) — same AbortController-timeout pattern already proven
// in lib/platforms/*.ts for the platform connectors, pulled out once here
// instead of each module reimplementing it slightly differently. Without
// this, a slow/unresponsive provider would hang that step (and the
// sequential Execution Engine behind it) indefinitely.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
