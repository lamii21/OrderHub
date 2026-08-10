import { searchSimilarChunks, type ChunkSearchResult } from "./repository";
import { resolvePlatformEmbeddingProvider } from "./provider-config";
import type { RetrievedChunk } from "./types";

// The platform default when a shop's own ai_agents.rag_top_k is null
// (Étape 8.0's own comment on that column already promised the default
// would live here, where retrieval actually happens).
export const DEFAULT_RAG_TOP_K = 5;

// A cosine similarity floor below which a chunk is dropped even if it
// ranked inside the top-k. 0.72 is a deliberately CONSERVATIVE V2
// baseline, not claimed as optimal — chosen on Phase 10 Étape 10.4's
// larger 50-query eval dataset (up from V1's 12) specifically to
// eliminate every false positive observed among that dataset's
// relevantDocumentTitles: [] queries (unanswerable-by-design questions),
// at the cost of recall: hit rate on the 45 expectation-bearing queries
// is 93.3% at 0.72, down from 100% at 0.68. Étape 10.4.x's margin
// analysis (best-relevant vs best-non-relevant similarity per query)
// found the underlying problem isn't generalized confusion — 43/45
// queries separate cleanly, mean margin 0.11 — but two structurally
// weak spots: Shipping Times <-> International Shipping and Customs
// (mean margin 0.079) and Returns and Refunds <-> Order Cancellation
// (mean margin 0.105, including a near-zero 0.0036 case), plus one
// unanswerable query ("Can I change the delivery address after placing
// an order?") scoring 0.7126 against Order Cancellation, above the
// weakest true positive in this dataset (0.6871). No single global
// threshold separates all of these; 0.72 was picked as the highest
// value that still clears that one false positive, not as a fix for the
// two weak document pairs above — those remain open (chunk overlap,
// deduplication, and reranking/hybrid search are the candidates being
// evaluated next, Étapes 10.6-10.8). Revalidate whenever the eval
// dataset (scripts/rag-eval/dataset.ts) or the embedding model changes.
const MIN_RELEVANCE_SCORE = 0.72;

// Caps how many chunks from the SAME document can appear in one result —
// keeps a single long document from crowding out every other source, same
// "diversity over raw rank" reasoning search results always need at scale.
const MAX_CHUNKS_PER_DOCUMENT = 2;

// A character budget across the whole returned set, not per chunk — same
// "token cost" discipline already applied to tools/products's
// DEFAULT_SEARCH_RESULT_LIMIT, sized for what a system prompt section can
// reasonably carry every single turn.
const MAX_TOTAL_CONTEXT_LENGTH = 4000;

// The one entry point this module exposes. Unlike indexDocument()
// (Étape 8.3), which throws loudly because indexing is a deliberate
// action a caller chose to take, this function NEVER throws — retrieval
// runs on every conversation turn (Étape 8.5), and a failure here (the
// embedding provider down, the platform not configured, a malformed
// query) must degrade to "no retrieved context" rather than break the
// customer's conversation. Every failure mode, expected or not, ends the
// same way: logged, empty array returned.
export async function retrieveRelevantChunks(
  shopId: number,
  queryText: string,
  topK: number = DEFAULT_RAG_TOP_K
): Promise<RetrievedChunk[]> {
  try {
    const trimmedQuery = queryText.trim();

    if (trimmedQuery === "") {
      return [];
    }

    const { provider, credentials } = resolvePlatformEmbeddingProvider();
    const { embedding } = await provider.embed(credentials, trimmedQuery);

    const results = await searchSimilarChunks(shopId, embedding, topK);
    const relevant = results.filter((result) => result.similarity >= MIN_RELEVANCE_SCORE);

    return capAndDeduplicate(relevant, MAX_CHUNKS_PER_DOCUMENT, MAX_TOTAL_CONTEXT_LENGTH);
  } catch (err) {
    console.error(`retrieveRelevantChunks: failed for shop ${shopId}:`, err);
    return [];
  }
}

// Only the exact k rows the database returned are ever considered — no
// over-fetching to compensate for what threshold/dedup filtering below
// might remove. A documented simplification, not an oversight: the
// result can legitimately come back shorter than topK once a low-scoring
// or duplicate-document chunk is dropped, same "simple over clever" trade
// already made for chunking's own lack of overlap (Étape 8.2).
function capAndDeduplicate(
  results: ChunkSearchResult[],
  maxPerDocument: number,
  maxTotalLength: number
): RetrievedChunk[] {
  const countByDocument = new Map<number, number>();
  const output: RetrievedChunk[] = [];
  let totalLength = 0;

  for (const result of results) {
    const countForDocument = countByDocument.get(result.document_id) ?? 0;

    if (countForDocument >= maxPerDocument) {
      continue;
    }

    // Results arrive already ordered by relevance (best first, from the
    // RPC's own ORDER BY) — once the budget can't fit the next-best
    // chunk, nothing further would outrank it, so stop rather than skip
    // ahead looking for a smaller one.
    if (totalLength + result.content.length > maxTotalLength) {
      break;
    }

    output.push({
      document_type: result.document_type,
      title: result.document_title,
      content: result.content,
      score: result.similarity,
    });

    countByDocument.set(result.document_id, countForDocument + 1);
    totalLength += result.content.length;
  }

  return output;
}
