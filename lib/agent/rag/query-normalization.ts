// Pure, deterministic RAG query normalization — no I/O. Strips only
// explicit structured references (an order/customer/invoice number, with
// or without a leading "#") from the text handed to retrieveRelevantChunks
// (Étape 10.9.z, "variant 2 — explicitOrderReference"), never touching a
// bare number that isn't anchored to one of those three keywords.
//
// Motivation, measured in Étape 10.9.y/10.9.z's own observation-only
// experiments (never committed, run against the real embedding provider):
// a composed query like "What is the refund policy for my order #4521?"
// scored 0 chunks against the production 0.72 threshold, while the same
// question without the order number scored 0.77-0.86 and retrieved
// correctly — the order number dilutes the embedding without adding any
// retrieval-relevant signal. Stripping only keyword-anchored references
// (this function) recovered 7/8 of a set of composed queries with zero
// measured regression on the existing 45-query V2 baseline or on two
// queries built specifically to contain a semantically load-bearing
// number ("purchased after 2024", "orders over $500") — an earlier,
// broader variant tested in the same experiment (stripping every 3+ digit
// number, not just keyword-anchored ones) measurably degraded those two
// scores instead, which is why this narrower rule was chosen over it.
//
// Deliberately does NOT attempt to fix every composed-query failure mode:
// "Order #5567: can I track it and how do refunds work if I return it?"
// remained a zero-hit even after stripping "#5567" in that same
// experiment — a genuine multi-intent/multi-document retrieval limitation
// (the question asks about two different documents at once), not
// something a text-normalization rule can address. Left as a known,
// documented limitation rather than chased with a more aggressive regex.
const STRUCTURED_REFERENCE_PATTERN = /\b(order|customer|invoice)\s*(number\s*)?#?\d+\b/gi;
const HASH_REFERENCE_PATTERN = /#\d+/g;
const EXTRA_WHITESPACE_PATTERN = /\s{2,}/g;

export function normalizeRagQuery(queryText: string): string {
  return queryText
    .replace(STRUCTURED_REFERENCE_PATTERN, "$1")
    .replace(HASH_REFERENCE_PATTERN, "")
    .replace(EXTRA_WHITESPACE_PATTERN, " ")
    .trim();
}
