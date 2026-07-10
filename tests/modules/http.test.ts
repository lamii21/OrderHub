import { describe, it, expect, vi, afterEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { fetchWithTimeout, isTimeoutError } from "@/lib/automation-modules/http";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("passes through a normal response unchanged", async () => {
    mockFetchSequence([{ status: 201 }]);

    const response = await fetchWithTimeout("https://example.com");

    expect(response.status).toBe(201);
  });

  it("forwards the given init (method/headers/body)", async () => {
    const fetchMock = mockFetchSequence([{ status: 200 }]);

    await fetchWithTimeout("https://example.com", { method: "PUT", body: "hello" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("hello");
  });

  it("aborts and rejects with an AbortError once the timeout elapses", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      })
    );

    const promise = fetchWithTimeout("https://example.com", {}, 5000);
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});

describe("isTimeoutError", () => {
  it("recognizes an AbortError", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isTimeoutError(err)).toBe(true);
  });

  it("does not treat a generic error as a timeout", () => {
    expect(isTimeoutError(new Error("ECONNRESET"))).toBe(false);
  });

  it("does not treat a non-Error value as a timeout", () => {
    expect(isTimeoutError("some string")).toBe(false);
  });
});
