import { describe, it, expect } from "vitest";
import { aggregate, formatReport, type AggregateStats } from "@/scripts/rag-eval/report";
import type { QueryEvalResult } from "@/scripts/rag-eval/metrics";

function result(overrides: Partial<QueryEvalResult>): QueryEvalResult {
  return {
    expectedRelevantCount: 1,
    hit: true,
    firstRelevantRank: 1,
    relevantRetrievedCount: 1,
    zeroHit: false,
    ...overrides,
  };
}

describe("aggregate", () => {
  it("computes hit rate, mean rank, and mean retrieved only over queries with expectations", () => {
    const stats = aggregate([
      result({ firstRelevantRank: 1, relevantRetrievedCount: 1 }),
      result({ firstRelevantRank: 3, relevantRetrievedCount: 2 }),
    ]);

    expect(stats.queriesWithExpectations).toBe(2);
    expect(stats.hitCount).toBe(2);
    expect(stats.hitRate).toBe(1);
    expect(stats.meanFirstRelevantRank).toBe(2);
    expect(stats.meanRelevantRetrieved).toBe(1.5);
  });

  it("excludes queries with expectedRelevantCount 0 from hit rate and zero-hit count entirely", () => {
    const stats = aggregate([
      result({}),
      result({ expectedRelevantCount: 0, hit: false, firstRelevantRank: null, relevantRetrievedCount: 0, zeroHit: true }),
    ]);

    expect(stats.totalQueries).toBe(2);
    expect(stats.queriesWithExpectations).toBe(1);
    expect(stats.queriesWithoutExpectations).toBe(1);
    expect(stats.hitCount).toBe(1);
    expect(stats.zeroHitCount).toBe(0);
  });

  it("counts a genuine miss (expected something, found nothing) in zeroHitCount", () => {
    const stats = aggregate([
      result({ hit: false, firstRelevantRank: null, relevantRetrievedCount: 0, zeroHit: true }),
    ]);

    expect(stats.zeroHitCount).toBe(1);
    expect(stats.hitRate).toBe(0);
  });

  it("excludes misses (null rank) from the mean rank rather than treating them as 0", () => {
    const stats = aggregate([
      result({ firstRelevantRank: 4 }),
      result({ hit: false, firstRelevantRank: null, relevantRetrievedCount: 0, zeroHit: true }),
    ]);

    expect(stats.meanFirstRelevantRank).toBe(4);
  });

  it("reports null rates rather than 0 when there are no queries with expectations at all", () => {
    const stats = aggregate([
      result({ expectedRelevantCount: 0, hit: false, firstRelevantRank: null, relevantRetrievedCount: 0, zeroHit: true }),
    ]);

    expect(stats.hitRate).toBeNull();
    expect(stats.meanFirstRelevantRank).toBeNull();
    expect(stats.meanRelevantRetrieved).toBeNull();
  });

  it("returns all-zero, non-null-crashing stats for an empty result list", () => {
    const stats = aggregate([]);

    expect(stats).toEqual<AggregateStats>({
      totalQueries: 0,
      queriesWithExpectations: 0,
      queriesWithoutExpectations: 0,
      hitCount: 0,
      hitRate: null,
      meanFirstRelevantRank: null,
      meanRelevantRetrieved: null,
      zeroHitCount: 0,
    });
  });
});

describe("formatReport", () => {
  const baseStats: AggregateStats = {
    totalQueries: 2,
    queriesWithExpectations: 2,
    queriesWithoutExpectations: 0,
    hitCount: 2,
    hitRate: 1,
    meanFirstRelevantRank: 1.5,
    meanRelevantRetrieved: 1,
    zeroHitCount: 0,
  };

  it("includes the query count, top-N, and both section labels", () => {
    const report = formatReport({
      totalQueries: 2,
      rawTopN: 20,
      rawStats: baseStats,
      productionStats: baseStats,
      errors: [],
      shopCleaned: true,
    });

    expect(report).toContain("Queries: 2");
    expect(report).toContain("Raw vector search (top 20)");
    expect(report).toContain("Production retriever");
    expect(report).toContain("Temporary shop cleaned: yes");
  });

  it("reports n/a rather than a computed rate when there are no queries with expectations", () => {
    const emptyStats: AggregateStats = {
      totalQueries: 1,
      queriesWithExpectations: 0,
      queriesWithoutExpectations: 1,
      hitCount: 0,
      hitRate: null,
      meanFirstRelevantRank: null,
      meanRelevantRetrieved: null,
      zeroHitCount: 0,
    };

    const report = formatReport({
      totalQueries: 1,
      rawTopN: 20,
      rawStats: emptyStats,
      productionStats: emptyStats,
      errors: [],
      shopCleaned: true,
    });

    expect(report).toContain("Hit rate: n/a");
    expect(report).toContain("First relevant rank (mean, hits only): n/a");
  });

  it("lists every error with its query when errors occurred", () => {
    const report = formatReport({
      totalQueries: 2,
      rawTopN: 20,
      rawStats: baseStats,
      productionStats: baseStats,
      errors: [{ query: "How long does shipping take?", error: "embedding API timed out" }],
      shopCleaned: true,
    });

    expect(report).toContain("Errors: 1");
    expect(report).toContain('"How long does shipping take?": embedding API timed out');
  });

  it("reports a failed cleanup honestly rather than assuming success", () => {
    const report = formatReport({
      totalQueries: 2,
      rawTopN: 20,
      rawStats: baseStats,
      productionStats: baseStats,
      errors: [],
      shopCleaned: false,
    });

    expect(report).toContain("Temporary shop cleaned: no");
  });
});
