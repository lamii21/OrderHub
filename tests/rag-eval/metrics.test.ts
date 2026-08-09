import { describe, it, expect } from "vitest";
import { evaluateQuery } from "@/scripts/rag-eval/metrics";

describe("evaluateQuery", () => {
  it("reports a hit at rank 1 when the top result is the (only) expected document", () => {
    const result = evaluateQuery(["Shipping Times"], ["Shipping Times", "Returns and Refunds"]);

    expect(result).toEqual({
      expectedRelevantCount: 1,
      hit: true,
      firstRelevantRank: 1,
      relevantRetrievedCount: 1,
      zeroHit: false,
    });
  });

  it("reports the rank of the first expected title, not the first returned result", () => {
    const result = evaluateQuery(
      ["Returns and Refunds"],
      ["Shipping Times", "Order Cancellation", "Returns and Refunds"]
    );

    expect(result.firstRelevantRank).toBe(3);
    expect(result.hit).toBe(true);
  });

  it("counts every distinct expected title found, for a multi-document query", () => {
    const result = evaluateQuery(
      ["Shipping Times", "International Shipping and Customs"],
      ["International Shipping and Customs", "Returns and Refunds", "Shipping Times"]
    );

    expect(result.relevantRetrievedCount).toBe(2);
    expect(result.expectedRelevantCount).toBe(2);
    expect(result.firstRelevantRank).toBe(1);
  });

  it("does not double-count a title that appears more than once in the returned results", () => {
    const result = evaluateQuery(["Shipping Times"], ["Shipping Times", "Shipping Times"]);

    expect(result.relevantRetrievedCount).toBe(1);
  });

  it("reports a genuine miss — expected titles existed, but none were found", () => {
    const result = evaluateQuery(["Promo Code Troubleshooting"], ["Shipping Times", "Returns and Refunds"]);

    expect(result).toEqual({
      expectedRelevantCount: 1,
      hit: false,
      firstRelevantRank: null,
      relevantRetrievedCount: 0,
      zeroHit: true,
    });
  });

  it("reports zeroHit for an unanswerable query without treating it as a miss", () => {
    const result = evaluateQuery([], ["Shipping Times", "Returns and Refunds"]);

    expect(result.zeroHit).toBe(true);
    expect(result.expectedRelevantCount).toBe(0);
    // The caller (10.0.d) is the one that must treat expectedRelevantCount
    // === 0 as "correct outcome" rather than "miss" — this module only
    // reports the raw fact that nothing expected was found, on purpose.
  });

  it("handles an empty returned-results list", () => {
    const result = evaluateQuery(["Shipping Times"], []);

    expect(result).toEqual({
      expectedRelevantCount: 1,
      hit: false,
      firstRelevantRank: null,
      relevantRetrievedCount: 0,
      zeroHit: true,
    });
  });

  it("treats a duplicated expected title as a single expected document", () => {
    const result = evaluateQuery(["Shipping Times", "Shipping Times"], ["Shipping Times"]);

    expect(result.expectedRelevantCount).toBe(1);
    expect(result.relevantRetrievedCount).toBe(1);
  });
});
