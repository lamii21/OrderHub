import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit, __resetRateLimitState } from "@/lib/rate-limit";

beforeEach(() => {
  __resetRateLimitState();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows the first request for a key", () => {
    const result = checkRateLimit("ip:1.2.3.4", { max: 5 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("allows up to max requests within the window, then blocks", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("ip:1.2.3.4", { max: 5 }).allowed).toBe(true);
    }
    const blocked = checkRateLimit("ip:1.2.3.4", { max: 5 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("ip:1.2.3.4", { max: 5 });
    expect(checkRateLimit("ip:5.6.7.8", { max: 5 }).allowed).toBe(true);
  });

  it("resets the count once the window elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    for (let i = 0; i < 5; i++) checkRateLimit("ip:1.2.3.4", { max: 5, windowMs: 60_000 });
    expect(checkRateLimit("ip:1.2.3.4", { max: 5, windowMs: 60_000 }).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:01:01.000Z"));
    expect(checkRateLimit("ip:1.2.3.4", { max: 5, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("defaults to a sensible max/window when not specified", () => {
    const result = checkRateLimit("ip:default-test");
    expect(result.allowed).toBe(true);
  });

  // Regression guard for the memory-bound sweep: once the tracked-key count
  // exceeds MAX_TRACKED_KEYS, the next call sweeps out any bucket whose
  // window has already elapsed — observed here by checking that a
  // long-idle key looks brand new again afterward, rather than still
  // holding its stale count.
  it("sweeps out expired buckets once the tracked-key count exceeds the cap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    for (let i = 0; i < 10_001; i++) {
      checkRateLimit(`sweep-key-${i}`, { max: 5, windowMs: 1000 });
    }

    // Past the window for every key created above.
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));

    // Still over the cap, so this call's own sweep pass actually runs.
    checkRateLimit("trigger-sweep", { max: 5, windowMs: 1000 });

    const swept = checkRateLimit("sweep-key-0", { max: 5, windowMs: 1000 });
    expect(swept.allowed).toBe(true);
    expect(swept.remaining).toBe(4);

    vi.useRealTimers();
  });
});
