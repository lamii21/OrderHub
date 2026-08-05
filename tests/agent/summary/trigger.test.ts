import { describe, it, expect } from "vitest";
import { shouldSummarize, SUMMARY_TRIGGER_INTERVAL } from "@/lib/agent/summary/trigger";

describe("shouldSummarize", () => {
  it("triggers on the default interval", () => {
    expect(shouldSummarize(SUMMARY_TRIGGER_INTERVAL)).toBe(true);
    expect(shouldSummarize(SUMMARY_TRIGGER_INTERVAL * 2)).toBe(true);
  });

  it("does not trigger on a count that isn't a multiple of the interval", () => {
    expect(shouldSummarize(SUMMARY_TRIGGER_INTERVAL - 1)).toBe(false);
    expect(shouldSummarize(SUMMARY_TRIGGER_INTERVAL + 1)).toBe(false);
  });

  it("never triggers on zero messages", () => {
    expect(shouldSummarize(0)).toBe(false);
  });

  it("honors an explicit interval override instead of the default", () => {
    expect(shouldSummarize(5, 5)).toBe(true);
    expect(shouldSummarize(4, 5)).toBe(false);
  });
});
