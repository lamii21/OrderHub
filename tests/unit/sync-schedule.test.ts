import { describe, it, expect, vi, afterEach } from "vitest";
import { isValidSyncFrequency, computeNextSyncAt, isSyncDue, SYNC_FREQUENCIES } from "@/lib/sync-schedule";

afterEach(() => {
  vi.useRealTimers();
});

describe("isValidSyncFrequency", () => {
  it.each(SYNC_FREQUENCIES.map((f) => f.value))("accepts %s", (value) => {
    expect(isValidSyncFrequency(value)).toBe(true);
  });

  it("rejects an unknown frequency", () => {
    expect(isValidSyncFrequency("every_minute")).toBe(false);
  });
});

describe("computeNextSyncAt", () => {
  it("returns null when the shop has never been attempted", () => {
    expect(computeNextSyncAt({ sync_frequency: "daily", last_sync_attempt_at: null })).toBeNull();
  });

  it("adds the frequency's hour count to the last attempt", () => {
    const next = computeNextSyncAt({
      sync_frequency: "every_6h",
      last_sync_attempt_at: "2026-01-01T00:00:00.000Z",
    });
    expect(next?.toISOString()).toBe("2026-01-01T06:00:00.000Z");
  });

  it("falls back to 24h for an unrecognized frequency", () => {
    const next = computeNextSyncAt({
      sync_frequency: "bogus",
      last_sync_attempt_at: "2026-01-01T00:00:00.000Z",
    });
    expect(next?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("isSyncDue", () => {
  it("is due when never attempted", () => {
    expect(isSyncDue({ sync_frequency: "daily", last_sync_attempt_at: null })).toBe(true);
  });

  it("is not due when the next sync is in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));

    expect(
      isSyncDue({ sync_frequency: "daily", last_sync_attempt_at: "2026-01-01T00:00:00.000Z" })
    ).toBe(false);
  });

  it("is due once the next sync time has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T01:00:00.000Z"));

    expect(
      isSyncDue({ sync_frequency: "daily", last_sync_attempt_at: "2026-01-01T00:00:00.000Z" })
    ).toBe(true);
  });
});
