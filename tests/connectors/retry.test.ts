import { describe, it, expect, vi } from "vitest";
import { fetchWithRetry } from "@/lib/platforms/retry";

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
