import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, setErrorReporter } from "@/lib/logger";

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
  // setErrorReporter's registration is module-scope state, same reason.
  setErrorReporter(null);
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

  describe("setErrorReporter", () => {
    it("forwards error() calls to the registered reporter with the same event/fields", () => {
      const reporter = vi.fn();
      setErrorReporter(reporter);

      logger.error("webhook.failed", { shopId: 2 });

      expect(reporter).toHaveBeenCalledWith("webhook.failed", { shopId: 2 });
    });

    it("never forwards info() or warn() calls, only error()", () => {
      const reporter = vi.fn();
      setErrorReporter(reporter);

      logger.info("shop.connected", { shopId: 1 });
      logger.warn("sync.slow", { durationMs: 9000 });

      expect(reporter).not.toHaveBeenCalled();
    });

    it("is a no-op by default (no reporter registered) — existing behavior is unchanged", () => {
      logger.error("webhook.failed", { shopId: 2 });

      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("a reporter that itself throws never breaks the caller's own logging", () => {
      setErrorReporter(() => {
        throw new Error("Sentry is down");
      });

      expect(() => logger.error("webhook.failed", { shopId: 2 })).not.toThrow();
      // The original error log still went out, plus one more for the
      // reporter's own failure — never fewer than the caller expected.
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });

    it("setErrorReporter(null) un-registers a previously set reporter", () => {
      const reporter = vi.fn();
      setErrorReporter(reporter);
      setErrorReporter(null);

      logger.error("webhook.failed", { shopId: 2 });

      expect(reporter).not.toHaveBeenCalled();
    });
  });
});
