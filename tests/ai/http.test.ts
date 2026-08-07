import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAbortSignal } from "@/lib/ai/http";

afterEach(() => {
  vi.useRealTimers();
});

describe("buildAbortSignal", () => {
  it("returns a signal that is not yet aborted", () => {
    const { signal, clear } = buildAbortSignal(1000);
    expect(signal.aborted).toBe(false);
    clear();
  });

  it("aborts the signal once the timeout elapses", () => {
    vi.useFakeTimers();
    const { signal, clear } = buildAbortSignal(1000);

    vi.advanceTimersByTime(1000);

    expect(signal.aborted).toBe(true);
    clear();
  });

  it("clear() prevents the timeout from firing later", () => {
    vi.useFakeTimers();
    const { signal, clear } = buildAbortSignal(1000);

    clear();
    vi.advanceTimersByTime(1000);

    expect(signal.aborted).toBe(false);
  });

  it("aborts when the external signal fires, even before the timeout", () => {
    const external = new AbortController();
    const { signal, clear } = buildAbortSignal(60_000, external.signal);

    external.abort();

    expect(signal.aborted).toBe(true);
    clear();
  });

  it("returns the internal controller's own signal when no external one is given", () => {
    const { signal, clear } = buildAbortSignal(1000);
    expect(signal).toBeInstanceOf(AbortSignal);
    clear();
  });
});
