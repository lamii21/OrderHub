import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, formatRelativeTime, formatDuration, startOfTodayUTC } from "@/lib/utils";

afterEach(() => {
  vi.useRealTimers();
});

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("formatRelativeTime", () => {
  it("formats sub-minute durations as 'just now'", () => {
    expect(formatRelativeTime(new Date(Date.now() - 5_000))).toBe("just now");
  });

  it("formats minutes", () => {
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60_000))).toBe("5 minutes ago");
  });

  it("uses singular for 1 minute", () => {
    expect(formatRelativeTime(new Date(Date.now() - 60_000))).toBe("1 minute ago");
  });

  it("formats hours", () => {
    expect(formatRelativeTime(new Date(Date.now() - 3 * 3_600_000))).toBe("3 hours ago");
  });

  it("formats days", () => {
    expect(formatRelativeTime(new Date(Date.now() - 2 * 86_400_000))).toBe("2 days ago");
  });
});

describe("formatDuration", () => {
  it("formats sub-second durations in milliseconds", () => {
    expect(formatDuration(450)).toBe("450ms");
  });

  it("formats durations of at least a second in seconds", () => {
    expect(formatDuration(1500)).toBe("1.5s");
  });

  it("formats exactly 1000ms as 1.0s", () => {
    expect(formatDuration(1000)).toBe("1.0s");
  });
});

describe("startOfTodayUTC", () => {
  it("returns UTC midnight for the current day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:32:10.000Z"));

    expect(startOfTodayUTC().toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });
});
