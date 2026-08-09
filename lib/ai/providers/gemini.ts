import { AiAuthenticationError, AiProviderError, AiRateLimitError, AiTimeoutError, AiValidationError } from "../errors";
import { buildAbortSignal } from "../http";
import type { AiCredentials, EmbeddingProvider, EmbeddingResult } from "../types";

// UNVERIFIED AGAINST A LIVE GOOGLE AI ACCOUNT — built against Google's
// published Generative Language API reference for embedContent. A real
// call was made against a live key with the previous model
// (text-embedding-004) and failed with HTTP 404 — Google retired that
// model on 2026-01-14. This file now targets gemini-embedding-2, its
// documented replacement, but that has not itself been exercised
// successfully against a live key yet. Same disclosure precedent as
// lib/platforms/youcan.ts, lib/automation-modules/payment-link.ts, and
// lib/ai/providers/openrouter.ts elsewhere in this project.
//
// The concrete embedding provider chosen for Phase 8's RAG — not an
// arbitrary pick: supabase/schema.sql's agent_document_chunks.embedding
// column is a vector(768), a single fixed dimension shared by every shop.
// gemini-embedding-2 defaults to 3072 dimensions, so every call explicitly
// requests output_dimensionality: 768 below — unlike the older
// gemini-embedding-001, gemini-embedding-2 auto-normalizes a truncated
// output, so no extra normalization step is needed here to keep the
// resulting vector meaningful for cosine similarity.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Matches agent_document_chunks.embedding's vector(768) column exactly —
// see the disclosure comment above for why this must be requested
// explicitly rather than left at gemini-embedding-2's own 3072 default.
const OUTPUT_DIMENSIONALITY = 768;

// Same reasoning as openrouter.ts's own TIMEOUT_MS: longer than the
// 10-15s timeouts used for plain REST calls elsewhere in this project,
// since this is a model inference call, not a simple CRUD request.
const TIMEOUT_MS = 30_000;

const PROVIDER_NAME = "gemini";

// embedContent's REST response wraps the embedding in a singular
// `embedding` object — confirmed against a live call (Phase 10 Étape
// 10.0.e diagnostic); the `embeddings` (plural array) shape shown in
// Google's own SDK code samples belongs to the client library's own
// abstraction (which also fronts the separate batchEmbedContents
// endpoint), not to this raw REST contract.
type GeminiEmbedResponse = {
  embedding?: { values?: number[] };
};

async function embed(
  credentials: AiCredentials,
  text: string,
  options?: { abortSignal?: AbortSignal }
): Promise<EmbeddingResult> {
  // Google's REST resource name for a model is "models/{id}" in both the
  // URL path and the request body — credentials.model stays the bare id
  // (e.g. "text-embedding-004", matching every other AiCredentials.model
  // in this project), this is the one place that adds the prefix back.
  const modelPath = `models/${credentials.model}`;
  const url = `${GEMINI_API_BASE}/${modelPath}:embedContent?key=${encodeURIComponent(credentials.apiKey)}`;

  const { signal, clear } = buildAbortSignal(TIMEOUT_MS, options?.abortSignal);
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelPath,
        content: { parts: [{ text }] },
        output_dimensionality: OUTPUT_DIMENSIONALITY,
      }),
      signal,
    });
  } catch (err) {
    // Same "either source of abort reported the same way" posture as
    // openrouter.ts's own chat() — fetch's AbortError doesn't distinguish
    // which signal in the combination actually fired.
    if (err instanceof Error && err.name === "AbortError") {
      throw new AiTimeoutError(PROVIDER_NAME, TIMEOUT_MS);
    }
    throw new AiProviderError(`Network error: ${err instanceof Error ? err.message : String(err)}`, PROVIDER_NAME, {
      cause: err,
    });
  } finally {
    clear();
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AiAuthenticationError(PROVIDER_NAME);
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new AiRateLimitError(PROVIDER_NAME, retryAfter ? Number(retryAfter) : undefined);
    }

    if (response.status === 400 || response.status === 422) {
      const bodyText = await response.text().catch(() => "");
      throw new AiValidationError(
        PROVIDER_NAME,
        `request rejected (HTTP ${response.status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`
      );
    }

    throw new AiProviderError(`request failed (HTTP ${response.status})`, PROVIDER_NAME);
  }

  const data = (await response.json()) as GeminiEmbedResponse;
  const values = data.embedding?.values;

  // A 2xx response with no embedding at all is not a shape this API is
  // documented to return, but trusting an external response body without
  // checking is exactly what this project's own established posture
  // (lib/automation-modules/ai-agent.ts's parseAgentReply, openrouter.ts's
  // lenient tool-argument parsing) argues against — fails clearly here
  // rather than handing a caller an EmbeddingResult with an empty vector
  // that would only fail confusingly later, at the vector(768) column.
  if (!values || values.length === 0) {
    throw new AiProviderError("response contained no embedding values", PROVIDER_NAME);
  }

  return {
    embedding: values,
    model: credentials.model,
  };
}

export const geminiProvider: EmbeddingProvider = {
  name: PROVIDER_NAME,
  // Embeddings only — Gemini also offers a chat/generateContent API, but
  // nothing in this project has asked for it, and lib/ai/'s whole design
  // (Phase 3) exists specifically so a shop's chat provider and embedding
  // provider never have to be the same vendor. Registering this here as a
  // ChatProvider too would be capability nobody requested.
  capabilities: {
    chat: false,
    embeddings: true,
    tools: false,
    streaming: false,
    vision: false,
    jsonMode: false,
  },
  embed,
};
