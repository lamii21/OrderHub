import type { ChatProvider, EmbeddingProvider } from "./types";
import { UnsupportedEmbeddingError } from "./errors";
import { openrouterProvider } from "./providers/openrouter";

// Two independent registries, not one — this is what actually lets a shop
// pair "chat via OpenRouter" with "embeddings via a different provider"
// without lib/agent/engine.ts or lib/agent/rag.ts (later phases) ever
// branching on a provider name themselves. A provider module may appear in
// one registry, the other, or both, depending on what it genuinely
// supports — nothing here assumes symmetry between the two maps.
const chatProviders: Record<string, ChatProvider> = {
  openrouter: openrouterProvider,
};

const embeddingProviders: Record<string, EmbeddingProvider> = {
  // Populated in the RAG phase, once a concrete embedding provider has
  // actually been verified against a live account — see the Phase 3
  // analysis on why none ships yet.
};

export function getChatProvider(name: string): ChatProvider {
  const provider = chatProviders[name];

  if (!provider) {
    throw new Error(`No chat provider registered for "${name}"`);
  }

  return provider;
}

// Distinguishes "this name isn't a real provider at all" (plain Error, same
// as getChatProvider) from "this is a real provider, it just doesn't do
// embeddings" (UnsupportedEmbeddingError) — a caller can catch the latter
// specifically and, say, fall back to a different embedding provider,
// rather than treating every lookup failure the same way.
export function getEmbeddingProvider(name: string): EmbeddingProvider {
  const provider = embeddingProviders[name];

  if (provider) {
    return provider;
  }

  if (chatProviders[name]) {
    throw new UnsupportedEmbeddingError(name);
  }

  throw new Error(`No embedding provider registered for "${name}"`);
}

// Single source of truth for whichever UI eventually offers a provider
// dropdown (the AI Agent settings page, a later phase) — same role
// SUPPORTED_PLATFORMS already plays for lib/platforms/index.ts.
export const SUPPORTED_CHAT_PROVIDERS = Object.keys(chatProviders);
export const SUPPORTED_EMBEDDING_PROVIDERS = Object.keys(embeddingProviders);

export type {
  ChatProvider,
  EmbeddingProvider,
  ProviderCapabilities,
  ChatRole,
  ChatMessage,
  ChatTool,
  ChatToolCall,
  ChatUsage,
  ChatOptions,
  ChatResult,
  ChatFinishReason,
  EmbeddingResult,
  AiCredentials,
} from "./types";

export {
  AiProviderError,
  AiAuthenticationError,
  AiTimeoutError,
  AiRateLimitError,
  AiValidationError,
  UnsupportedEmbeddingError,
} from "./errors";
