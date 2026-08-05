// The interchangeable AI provider abstraction — same philosophy as
// lib/platforms/types.ts's PlatformConnector (interface + registry, credentials
// passed in explicitly rather than fetched by the provider itself, methods
// throw on failure rather than returning a {success} result). See the Phase
// 3 architecture analysis for why this mirrors the *connector* pattern
// rather than lib/automation-modules' AutomationModule pattern.
//
// Chat and embeddings are deliberately two separate interfaces, not one
// combined AiProvider — a shop can use OpenRouter for chat and a different
// provider for embeddings (see Phase 1 architecture doc §5/§7 on why a free
// chat model and a free embedding model are unlikely to be the same
// vendor), and neither lib/agent/engine.ts nor lib/agent/rag.ts (both later
// phases) should have to change if that pairing changes. A provider module
// implements whichever of the two interfaces it genuinely supports — never
// both just because the type historically bundled them together.

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  // Present only on a "tool" role message — which tool call this message is
  // the result of. Unused until Tool Calling (a later phase); included in
  // the type now so ChatMessage's shape never needs a breaking change when
  // that phase arrives — see the Phase 3 analysis on why this is safe to
  // add now but not to leave out.
  toolCallId?: string;
};

// JSON Schema, the shape every major provider's function/tool calling
// already speaks (OpenAI, Anthropic, Gemini) — defined now, wired up in the
// Tool Calling phase, so ChatOptions never needs a breaking change to gain
// real tools.
export type ChatTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ChatOptions = {
  // Overrides AiCredentials.model for this one call only — e.g. a cheaper
  // model for a quick intent classification, a stronger one for the actual
  // sales reply, without needing two separate credential rows.
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ChatTool[];
  // "json" asks the provider to guarantee a syntactically valid JSON body.
  // No provider implementation honors this yet (Phase 3 ships text-only) —
  // reserved so a later one can support it without changing every call
  // site's options object.
  responseFormat?: "text" | "json";
  // Free-form, provider-specific extras (e.g. top_p) that don't warrant a
  // first-class field yet. lib/ai/ itself never reads or interprets this —
  // only the concrete provider implementation may.
  metadata?: Record<string, unknown>;
  // Lets a caller cancel an in-flight request early (e.g. the customer sent
  // a new message before the first reply finished generating). Combined
  // with this call's own timeout, not a replacement for it — see
  // providers/openrouter.ts.
  abortSignal?: AbortSignal;
};

// Normalized across providers whose raw APIs spell this differently — a
// value this type doesn't recognize maps to "unknown" rather than the
// provider implementation throwing or the caller getting a raw string it
// has to defensively switch on. "tool_calls" means the model stopped to
// request a tool call, not that it finished answering — a caller checking
// only `content` without also checking this would miss that distinction.
export type ChatFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "unknown";

export type ChatResult = {
  content: string | null;
  // Which registered provider produced this result (ChatProvider.name) —
  // stamped by the provider itself, not the caller, so a dashboard
  // aggregating results from a shop that switched providers mid-history
  // never has to track that separately alongside each call.
  provider: string;
  // The model that actually answered — may differ from options.model if the
  // provider silently substituted one (observed behavior on some free-tier
  // routing providers), so a caller can detect and log that instead of
  // assuming the requested model was the one used.
  model: string;
  finishReason: ChatFinishReason;
  toolCalls?: ChatToolCall[];
  usage?: ChatUsage;
};

export type EmbeddingResult = {
  embedding: number[];
  usage?: { totalTokens: number };
  model: string;
};

// model is required, not defaulted or hard-coded here — same reasoning
// lib/automation-modules/ai-agent.ts's own AiAgentCredentials already
// documents: model ids move faster than this code should, and picking one
// on the shop's behalf risks silently going stale.
export type AiCredentials = {
  apiKey: string;
  model: string;
};

// Declared explicitly by every provider rather than inferred by the engine
// at call time (e.g. "try tool-calling and see if it errors", "check
// whether .embed exists") — the engine (Phase 5+) reads this once and
// branches on it, instead of every call site re-discovering the same fact
// through trial and error. `chat`/`embeddings` describe which of the two
// interfaces below this concrete module genuinely implements; the rest
// describe finer-grained features within `chat` specifically (a provider
// with `chat: false` has no meaningful value for any of them).
export type ProviderCapabilities = {
  chat: boolean;
  embeddings: boolean;
  tools: boolean;
  streaming: boolean;
  vision: boolean;
  jsonMode: boolean;
};

// Shared by both provider interfaces so `capabilities` and `name` are
// declared once, not duplicated on ChatProvider and EmbeddingProvider
// separately — a module implementing both still only writes each field a
// single time.
interface AiProviderIdentity {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
}

export interface ChatProvider extends AiProviderIdentity {
  chat(credentials: AiCredentials, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}

export interface EmbeddingProvider extends AiProviderIdentity {
  embed(credentials: AiCredentials, text: string, options?: { abortSignal?: AbortSignal }): Promise<EmbeddingResult>;
}
