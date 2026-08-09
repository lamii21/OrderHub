import { searchSimilarChunks, type ChunkSearchResult } from "./repository";
import { resolvePlatformEmbeddingProvider } from "./provider-config";
import type { RetrievedChunk } from "./types";

// The platform default when a shop's own ai_agents.rag_top_k is null
// (Étape 8.0's own comment on that column already promised the default
// would live here, where retrieval actually happens).
export const DEFAULT_RAG_TOP_K = 5;

// A cosine similarity floor below which a chunk is dropped even if it
// ranked inside the top-k. 0.74 is the Phase 10 Étape 10.1 calibrated V1
// value — chosen from a real threshold sweep (real Gemini embeddings,
// real pgvector search) against the RAG eval harness's 12
// expectation-bearing queries: 0.74 gave 100% hit rate, the previous 0.75
// gave 91.7% (one relevant document, scoring 0.7449, was dropped). The
// sweep also found a hard structural limit — an unrelated document
// scored 0.7553 for a different query, higher than that 0.7449 true
// match — so no single global threshold fully separates every correct
// match from every incorrect one on this dataset; 0.74 is the best
// value found, not a guarantee. The eval dataset is still deliberately
// small (scripts/rag-eval/dataset.ts) — revalidate this value once it
// grows.
const MIN_RELEVANCE_SCORE = 0.74;

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
