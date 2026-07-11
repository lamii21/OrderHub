import { describe, it, expect } from "vitest";
import { delayModule } from "@/lib/automation-modules/delay";
import type { Order } from "@/types/order";

const order = { id: 1 } as Order;

describe("delayModule.validateConfig", () => {
  it("accepts simple durations like 30m/2h/1d", () => {
    expect(delayModule.validateConfig!({ duration: "30m" })).toBeNull();
    expect(delayModule.validateConfig!({ duration: "2h" })).toBeNull();
    expect(delayModule.validateConfig!({ duration: "1d" })).toBeNull();
  });

  it("rejects a duration with no unit or an unsupported unit", () => {
    expect(delayModule.validateConfig!({ duration: "30" })).not.toBeNull();
    expect(delayModule.validateConfig!({ duration: "1w" })).not.toBeNull();
  });

  it("rejects a missing duration", () => {
    expect(delayModule.validateConfig!({})).not.toBeNull();
  });
});

describe("delayModule.run", () => {
  it("reports a waiting outcome with the parsed duration in milliseconds", async () => {
    const result = await delayModule.run(order, { duration: "2h" }, {});

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("waiting");
    expect(result.data).toEqual({ duration: "2h", durationMs: 2 * 60 * 60 * 1000 });
  });

  it("parses minutes and days correctly", async () => {
    expect((await delayModule.run(order, { duration: "45m" }, {})).data).toEqual({
      duration: "45m",
      durationMs: 45 * 60 * 1000,
    });
    expect((await delayModule.run(order, { duration: "3d" }, {})).data).toEqual({
      duration: "3d",
      durationMs: 3 * 24 * 60 * 60 * 1000,
    });
  });

  it("fails cleanly on an invalid duration even if validateConfig was somehow bypassed", async () => {
    const result = await delayModule.run(order, { duration: "not-a-duration" }, {});
    expect(result).toEqual({ success: false, message: 'Invalid delay duration "not-a-duration".' });
  });
});
