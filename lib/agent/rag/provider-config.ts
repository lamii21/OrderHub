import { getEmbeddingProvider, type EmbeddingProvider, type AiCredentials } from "@/lib/ai";
import { requireEnv } from "@/lib/env";

// The embedding provider/model are a platform-wide choice (Phase 8 Étape
// 8.0's architecture decision), never a per-shop one the way the AI
// Agent's own chat ai_provider/ai_model are — agent_document_chunks.embedding
// is a single fixed-dimension vector(768) column shared by every shop, so
// every embedding written to it must come from the same model. Read from
// the environment, not module_credentials: this isn't a per-shop
// "bring your own key" setting, it's platform infrastructure shared by
// every shop's RAG.
//
// requireEnv() throws immediately if any of these are unset — deliberate,
// unlike the "never blocks a conversation" posture the retrieval step
// (Étape 8.4/8.5) will need at the engine boundary. Indexing (this file's
// caller) is an explicit action a caller takes on purpose; it should fail
// loudly and clearly if the platform hasn't configured RAG, not silently
// do nothing.
export type PlatformEmbeddingConfig = {
  provider: EmbeddingProvider;
  credentials: AiCredentials;
};

export function resolvePlatformEmbeddingProvider(): PlatformEmbeddingConfig {
  const providerName = requireEnv("RAG_EMBEDDING_PROVIDER");
  const apiKey = requireEnv("RAG_EMBEDDING_API_KEY");
  const model = requireEnv("RAG_EMBEDDING_MODEL");

  return {
    provider: getEmbeddingProvider(providerName),
    credentials: { apiKey, model },
  };
}
