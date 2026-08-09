// Manual, real-backend RAG retrieval-quality baseline (Phase 10, Étape
// 10.0.d). Not part of `npm test` — makes real embedding API calls
// (billed, real latency) and provisions/tears down a real Supabase shop.
// Requires the same env vars indexDocument()/retrieveRelevantChunks()
// already need in production: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// RAG_EMBEDDING_PROVIDER, RAG_EMBEDDING_MODEL, RAG_EMBEDDING_API_KEY.
//
// Run with: npx tsx --env-file=.env.local scripts/rag-eval/run.ts
//
// Prints the current, unmodified retriever's behavior — this establishes
// the baseline Étapes 10.1-10.4 will each be compared against, one change
// at a time. Touches nothing in lib/agent/rag/retriever.ts or chunking.ts.
import { RAG_EVAL_DATASET } from "./dataset";
import { withEphemeralShop } from "./provision";
import { evaluateQuery, type QueryEvalResult } from "./metrics";
import { aggregate, formatReport } from "./report";
import { searchSimilarChunks } from "@/lib/agent/rag/repository";
import { retrieveRelevantChunks } from "@/lib/agent/rag/retriever";
import { resolvePlatformEmbeddingProvider } from "@/lib/agent/rag/provider-config";

// Generous on purpose: wide enough that a relevant chunk ranked outside
// today's production topK (5) is still visible to the raw-search side of
// the report, which is the whole point of measuring "brut" separately
// from "production" (see this phase's architecture analysis).
const RAW_TOP_N = 20;

type QueryError = { query: string; error: string };

async function runEvaluation(): Promise<void> {
  const rawResults: QueryEvalResult[] = [];
  const productionResults: QueryEvalResult[] = [];
  const errors: QueryError[] = [];

  // A single query's failure (an embedding call timing out, a transient
  // error) is recorded and the benchmark moves on — only provisioning
  // itself (shop creation, fixture indexing) or a callback that never
  // returns normally is allowed to fail the whole run, propagated by
  // withEphemeralShop unhandled below.
  const { result: totalQueries, shopCleaned } = await withEphemeralShop(
    RAG_EVAL_DATASET.documents,
    async (shopId) => {
      const { provider, credentials } = resolvePlatformEmbeddingProvider();

      for (const evalQuery of RAG_EVAL_DATASET.queries) {
        try {
          const { embedding } = await provider.embed(credentials, evalQuery.query);
          const rawSearch = await searchSimilarChunks(shopId, embedding, RAW_TOP_N);
          rawResults.push(
            evaluateQuery(
              evalQuery.relevantDocumentTitles,
              rawSearch.map((chunk) => chunk.document_title)
            )
          );

          const production = await retrieveRelevantChunks(shopId, evalQuery.query);
          productionResults.push(
            evaluateQuery(
              evalQuery.relevantDocumentTitles,
              production.map((chunk) => chunk.title)
            )
          );
        } catch (err) {
          errors.push({ query: evalQuery.query, error: err instanceof Error ? err.message : String(err) });
        }
      }

      return RAG_EVAL_DATASET.queries.length;
    }
  );

  // Deliberately formatted and printed after withEphemeralShop has already
  // resolved (cleanup has already run either way by this point) — not
  // because the report doesn't matter, but because there is no honest way
  // to write "Temporary shop cleaned: yes/no" from inside the callback,
  // before cleanup has actually happened.
  const report = formatReport({
    totalQueries,
    rawTopN: RAW_TOP_N,
    rawStats: aggregate(rawResults),
    productionStats: aggregate(productionResults),
    errors,
    shopCleaned,
  });

  console.log(report);
}

runEvaluation().catch((err) => {
  console.error("RAG eval run failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
