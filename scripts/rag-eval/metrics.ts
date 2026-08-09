// Pure scoring primitives for the RAG retrieval-quality baseline (Phase
// 10, Étape 10.0.b) — no Supabase, no embedding calls, no I/O, no global
// state. Deliberately takes and returns plain strings/booleans/numbers
// rather than any lib/agent/rag/ type: this module doesn't know or care
// whether "returnedDocumentTitles" came from a raw vector search or from
// the production retriever, which is exactly what lets the runner (10.0.d)
// reuse it for both without two near-duplicate scoring functions.
//
// No aggregate/summary function here on purpose — interpreting many
// QueryEvalResult values together (a hit rate, a mean rank, deciding what
// "good" looks like) is the runner's job (10.0.d), not this module's; this
// file only ever scores one query's results at a time.
export type QueryEvalResult = {
  // The number of distinct titles the dataset expected for this query.
  // Needed to tell apart "nothing was expected and nothing was found"
  // (relevantDocumentTitles: [], the correct outcome) from "something was
  // expected but nothing was found" (a real miss) — both produce
  // zeroHit: true, and only this field lets a caller distinguish them.
  expectedRelevantCount: number;
  // At least one expected title was found among the returned results.
  // Vacuously false when expectedRelevantCount is 0 — there is nothing to
  // find, so nothing can have been found.
  hit: boolean;
  // 1-indexed position of the first returned result whose title is an
  // expected one. null when no expected title appears anywhere in the
  // returned results, including when none were expected in the first
  // place.
  firstRelevantRank: number | null;
  // How many of the DISTINCT expected titles were found among the
  // returned results — not how many returned results matched (a title
  // appearing twice in the returned list is still one document found).
  relevantRetrievedCount: number;
  // No expected title was found among the returned results. True for a
  // genuine miss, but also true (correctly) when expectedRelevantCount is
  // 0 — the caller decides which case it's looking at using that field,
  // this one only reports what happened.
  zeroHit: boolean;
};

// returnedDocumentTitles must already be ranked best-first — rank is
// derived from position, this function does no sorting of its own.
export function evaluateQuery(
  relevantDocumentTitles: string[],
  returnedDocumentTitles: string[]
): QueryEvalResult {
  const expected = new Set(relevantDocumentTitles);
  const returnedSet = new Set(returnedDocumentTitles);

  let firstRelevantRank: number | null = null;
  for (let i = 0; i < returnedDocumentTitles.length; i++) {
    if (expected.has(returnedDocumentTitles[i])) {
      firstRelevantRank = i + 1;
      break;
    }
  }

  let relevantRetrievedCount = 0;
  for (const title of expected) {
    if (returnedSet.has(title)) {
      relevantRetrievedCount += 1;
    }
  }

  return {
    expectedRelevantCount: expected.size,
    hit: relevantRetrievedCount > 0,
    firstRelevantRank,
    relevantRetrievedCount,
    zeroHit: relevantRetrievedCount === 0,
  };
}
