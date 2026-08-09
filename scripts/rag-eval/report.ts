import type { QueryEvalResult } from "./metrics";

// Interpretation layer for Étape 10.0.b's per-query primitives — pure,
// same discipline as metrics.ts itself (no I/O), just operating on many
// QueryEvalResult values instead of one. Kept as its own file rather than
// added to metrics.ts: 10.0.b was validated as "measures one query,
// nothing more", this file is explicitly the next, separate increment
// ("l'interprétation viendra dans le runner 10.0.d").
export type AggregateStats = {
  totalQueries: number;
  queriesWithExpectations: number;
  queriesWithoutExpectations: number;
  hitCount: number;
  // null, not 0, when queriesWithExpectations is 0 — there is no rate to
  // report, and 0 would misleadingly read as "every query missed".
  hitRate: number | null;
  meanFirstRelevantRank: number | null;
  meanRelevantRetrieved: number | null;
  // A genuine miss count: only over queries that DID expect a relevant
  // document (queriesWithExpectations), never conflated with the
  // queriesWithoutExpectations for which zeroHit: true is the correct,
  // expected outcome — exactly the distinction expectedRelevantCount
  // exists in metrics.ts to make possible.
  zeroHitCount: number;
};

export function aggregate(results: QueryEvalResult[]): AggregateStats {
  const withExpectations = results.filter((result) => result.expectedRelevantCount > 0);
  const hitCount = withExpectations.filter((result) => result.hit).length;
  const zeroHitCount = withExpectations.filter((result) => result.zeroHit).length;
  const ranks = withExpectations
    .map((result) => result.firstRelevantRank)
    .filter((rank): rank is number => rank !== null);

  return {
    totalQueries: results.length,
    queriesWithExpectations: withExpectations.length,
    queriesWithoutExpectations: results.length - withExpectations.length,
    hitCount,
    hitRate: withExpectations.length > 0 ? hitCount / withExpectations.length : null,
    meanFirstRelevantRank: ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
    meanRelevantRetrieved:
      withExpectations.length > 0
        ? withExpectations.reduce((sum, result) => sum + result.relevantRetrievedCount, 0) /
          withExpectations.length
        : null,
    zeroHitCount,
  };
}

export type EvalReportInput = {
  totalQueries: number;
  // How many candidates the raw vector search step considered — part of
  // the report input (not hardcoded here) so this file stays independent
  // of whatever constant the runner (10.0.d) happens to use.
  rawTopN: number;
  rawStats: AggregateStats;
  productionStats: AggregateStats;
  errors: { query: string; error: string }[];
  shopCleaned: boolean;
};

function formatSection(label: string, stats: AggregateStats): string {
  const hitRateLine =
    stats.hitRate === null
      ? "  Hit rate: n/a (no queries with an expected document)"
      : `  Hit rate: ${stats.hitCount}/${stats.queriesWithExpectations} (${(stats.hitRate * 100).toFixed(1)}%)`;

  const rankLine =
    stats.meanFirstRelevantRank === null
      ? "  First relevant rank (mean, hits only): n/a"
      : `  First relevant rank (mean, hits only): ${stats.meanFirstRelevantRank.toFixed(2)}`;

  const retrievedLine =
    stats.meanRelevantRetrieved === null
      ? "  Relevant retrieved (mean): n/a"
      : `  Relevant retrieved (mean): ${stats.meanRelevantRetrieved.toFixed(2)}`;

  const zeroHitLine = `  Zero-hit: ${stats.zeroHitCount}/${stats.queriesWithExpectations}`;

  return [label, hitRateLine, rankLine, retrievedLine, zeroHitLine].join("\n");
}

export function formatReport(input: EvalReportInput): string {
  const lines = [
    "RAG Retrieval Evaluation",
    "========================",
    "",
    `Queries: ${input.totalQueries}`,
    "",
    formatSection(`Raw vector search (top ${input.rawTopN})`, input.rawStats),
    "",
    formatSection("Production retriever", input.productionStats),
    "",
    `Queries with no expected relevant document: ${input.rawStats.queriesWithoutExpectations}`,
    `Errors: ${input.errors.length}`,
  ];

  if (input.errors.length > 0) {
    lines.push("");
    for (const { query, error } of input.errors) {
      lines.push(`  - "${query}": ${error}`);
    }
  }

  lines.push("", `Temporary shop cleaned: ${input.shopCleaned ? "yes" : "no"}`);

  return lines.join("\n");
}
