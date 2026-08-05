// Typed error hierarchy for lib/ai/ — lets a caller (lib/agent/engine.ts,
// from Phase 5 onward) branch on `instanceof` instead of parsing a
// provider's error message text, which differs from one API to the next and
// would make that branching brittle. Every subclass carries `provider` so a
// caller logging or displaying the error never has to re-derive which
// provider it came from.
//
// Deliberately plain `extends Error` classes, the same minimal shape as
// this project's one existing custom error (lib/net-guard.ts's
// UnsafeUrlError) — no error-code enums, no extra machinery beyond what
// each subclass actually needs.
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AiProviderError";
  }
}

// The API key configured in module_credentials (module_name
// "ai-sales-agent", see Phase 5) is missing, revoked, or wrong.
export class AiAuthenticationError extends AiProviderError {
  constructor(provider: string) {
    super(`${provider}: authentication failed — check the configured API key.`, provider);
    this.name = "AiAuthenticationError";
  }
}

// The request exceeded its time budget — either this call's own timeout, or
// a caller-supplied ChatOptions.abortSignal firing early (see
// providers/openrouter.ts's own comment on why the two aren't
// distinguished).
export class AiTimeoutError extends AiProviderError {
  constructor(provider: string, timeoutMs: number) {
    super(`${provider}: request timed out after ${timeoutMs / 1000}s.`, provider);
    this.name = "AiTimeoutError";
  }
}

// HTTP 429. retryAfterSeconds is populated when the provider's response
// carries a Retry-After header, so a future retry policy (none exists yet —
// see the Phase 3 analysis on why this ships without one) has a real number
// to work with instead of guessing a backoff.
export class AiRateLimitError extends AiProviderError {
  constructor(
    provider: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(`${provider}: rate limit exceeded.`, provider);
    this.name = "AiRateLimitError";
  }
}

// The request itself was rejected as malformed (HTTP 400/422) — a bad
// model name, an invalid tools schema, a prompt over the model's context
// window. Distinct from AiProviderError's catch-all so a caller can tell
// "my request was wrong" apart from "the provider is having a bad day".
export class AiValidationError extends AiProviderError {
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`, provider);
    this.name = "AiValidationError";
  }
}

// Thrown by getEmbeddingProvider() (lib/ai/index.ts) for a name that is a
// real, registered chat provider but was never registered for embeddings —
// distinct from "this name doesn't exist at all" so a caller can tell
// "wrong capability" apart from "typo'd the provider name".
export class UnsupportedEmbeddingError extends AiProviderError {
  constructor(provider: string) {
    super(`${provider}: does not support embeddings.`, provider);
    this.name = "UnsupportedEmbeddingError";
  }
}
