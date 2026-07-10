import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "@/lib/logger";

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  // vi.spyOn on an already-spied console method reuses the same mock
  // instance rather than layering a fresh one — without restoring here,
  // .mock.calls accumulates across every test in this file instead of
  // resetting per test.
  vi.restoreAllMocks();
});

function parsedCall(spy: ReturnType<typeof vi.spyOn>) {
  return JSON.parse(spy.mock.calls[0][0] as string);
}

describe("logger", () => {
  it("info() writes a single JSON line via console.log with level/event/timestamp", () => {
    logger.info("shop.connected", { shopId: 1 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = parsedCall(logSpy);
    expect(entry.level).toBe("info");
    expect(entry.event).toBe("shop.connected");
    expect(entry.shopId).toBe(1);
    expect(typeof entry.timestamp).toBe("string");
  });

  it("warn() writes via console.warn", () => {
    logger.warn("sync.slow", { durationMs: 9000 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(parsedCall(warnSpy).level).toBe("warn");
  });

  it("error() writes via console.error", () => {
    logger.error("webhook.failed", { shopId: 2 });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(parsedCall(errorSpy).level).toBe("error");
  });

  it("audit() is an info-level log with audit: true set", () => {
    logger.audit("shop.deleted", { shopId: 3 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = parsedCall(logSpy);
    expect(entry.level).toBe("info");
    expect(entry.audit).toBe(true);
    expect(entry.shopId).toBe(3);
  });

  it("works with no fields at all", () => {
    logger.info("startup.env_validation_passed");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(parsedCall(logSpy).event).toBe("startup.env_validation_passed");
  });
});
