import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry, fetchWithTimeout } from "@/lib/platforms/retry";

function response(status: number, headers: Record<string, string> = {}) {
  const headerMap = new Map(Object.entries(headers));
  return { status, headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null } } as Response;
}

describe("fetchWithRetry", () => {
  it("returns immediately on a non-429 response, calling fetcher only once", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200));

    const result = await fetchWithRetry(fetcher, { providerName: "TestProvider" });

    expect(result.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and succeeds once the provider stops rate-limiting", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(response(429, { "retry-after": "1" })).mockResolvedValueOnce(response(200));

    const promise = fetchWithRetry(fetcher, { providerName: "TestProvider" });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws a descriptive error after exceeding maxRetries, still 429", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(response(429, { "retry-after": "1" }));

    const promise = fetchWithRetry(fetcher, { providerName: "TestProvider", maxRetries: 2 });
    const assertion = expect(promise).rejects.toThrow(
      "TestProvider rate limit exceeded after 2 retries"
    );
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    // 1 initial attempt + 2 retries = 3 calls.
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("defaults the retry delay to 1 second when Retry-After is missing/invalid", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(response(429)).mockResolvedValueOnce(response(200));

    const promise = fetchWithRetry(fetcher, { providerName: "TestProvider" });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.status).toBe(200);
    vi.useRealTimers();
  });
});

// Shared by shopify.ts/woocommerce.ts/youcan.ts (consolidated out of 3
// near-identical copies) — exercised directly here rather than only
// indirectly through each connector's own tests.
describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves normally well within the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200)));

    const result = await fetchWithTimeout("https://example.com", {}, 15_000, "TestProvider");

    expect(result.status).toBe(200);
  });

  it("passes the given init through, plus its own abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithTimeout("https://example.com", { headers: { Authorization: "Bearer x" } }, 15_000, "TestProvider");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer x");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a timeout with the provider's name in the message, distinct from a generic network error", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(fetchWithTimeout("https://example.com", {}, 15_000, "TestProvider")).rejects.toThrow(
      "TestProvider request timed out after 15s"
    );
  });

  it("propagates a non-timeout error unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    await expect(fetchWithTimeout("https://example.com", {}, 15_000, "TestProvider")).rejects.toThrow(
      "ECONNRESET"
    );
  });
});
