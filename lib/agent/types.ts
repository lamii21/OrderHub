import type { ChatFinishReason, ChatUsage } from "@/lib/ai";

// The conversation domain's shared vocabulary — read by every module under
// lib/agent/ (repository, service, memory, channels, and later engine/
// context/prompt/summary), written by none of them here. Field casing
// matches this project's existing convention of mirroring database columns
// directly (see types/order.ts's Order type) rather than camelCase — the
// restructuring this file does versus a raw table copy is in *shape*
// (entities vs. context bundles vs. value objects, memory as one cohesive
// object instead of two sibling columns), not in naming style.
//
// Three deliberately distinct kinds of type below:
//   - Entities (AgentConversation, AgentMessage) — have identity (`id`),
//     persist, mutate over time.
//   - Context objects (ConversationContext and its two sub-contexts) — a
//     read-only bundle assembled for one purpose (feeding the engine in a
//     later phase), never persisted as their own row.
//   - Value objects (ConversationMemory, ConversationMetrics,
//     ConversationState, MessageMetadata) — defined entirely by their
//     content, no identity of their own.

// ---------------------------------------------------------------------------
// Enums — single source of truth as a const array, same pattern already
// used by ORDER_STATUSES (lib/validation.ts) and EVENT_TYPES
// (lib/events/types.ts). The database's own CHECK constraints
// (supabase/schema.sql) are the other place each of these lists has to be
// kept in sync by hand — same accepted trade-off ORDER_STATUSES already
// documents, not a new one.
// ---------------------------------------------------------------------------

export const CONVERSATION_STATUSES = ["open", "resolved", "escalated"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_CONTENT_TYPES = ["text", "structured"] as const;
export type MessageContentType = (typeof MESSAGE_CONTENT_TYPES)[number];

// MessageRole is defined independently here rather than reusing lib/ai's
// ChatRole, even though the two currently share the same four values.
// AgentMessage belongs to the conversation/persistence bounded context;
// ChatRole belongs to the AI provider bounded context. Aliasing one to the
// other would silently couple them — a future provider-specific role added
// to ChatRole for LLM purposes would otherwise leak into what gets persisted
// here. The translation between the two happens explicitly where a later
// phase maps AgentMessage[] to ChatMessage[] to call lib/ai/, which is
// exactly where a translation between bounded contexts belongs.

// channel is deliberately a plain string, not a closed union — the same
// choice already made for ChannelAdapter.channel (Phase 4 architecture
// review §7). Constraining it to a fixed list here would defeat the one
// property this whole subsystem is built to guarantee: adding a new
// channel is a new adapter, never a change to shared domain types.

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

// Bundled with its own version rather than as a sibling field on
// AgentConversation — the version belongs to the memory value being
// versioned, not to the conversation entity that merely holds a reference
// to it. supabase/schema.sql still stores this as two columns
// (memory jsonb, memory_version integer) for the same reason ORDER_STATUSES
// and its CHECK constraint are two representations of one concept: cheap to
// query as plain columns, cohesive as a domain value. The repository
// (a later step) is what reads two columns and constructs one object here.
export type ConversationMemory = {
  version: number;
  summary?: string;
  summary_updated_at?: string;
  facts?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
};

// The shape a per-message metadata blob is already known to need today,
// directly mirroring what lib/ai's ChatResult already produces (Phase 3) —
// not a speculative guess at future fields. Reuses ChatUsage/ChatFinishReason
// from lib/ai rather than redefining an equivalent shape, since both already
// exist and mean exactly the same thing here. The index signature keeps the
// underlying jsonb column's real purpose (extend without a migration) intact
// at the type level too — a future field (cost, cache, request id) is a type
// edit, never a schema change, and untyped values remain readable instead of
// silently dropped by a closed type.
export type MessageMetadata = {
  provider?: string;
  model?: string;
  latency_ms?: number;
  token_usage?: ChatUsage;
  finish_reason?: ChatFinishReason;
  // Present only on a message that resolved after one or more tool
  // round-trips (Phase 5 Étape 8) — the full trail of what was called and
  // with what result, attached to the one persisted row the turn actually
  // produced. The intermediate tool-call/tool-result exchange itself is
  // never persisted as its own agent_messages row (see engine/provider-loop.ts's
  // own comment on why); this field is what keeps that exchange auditable
  // without needing one.
  tool_calls?: AgentToolCall[];
  [key: string]: unknown;
};

// A domain-level record of one tool call's lifecycle, distinct from
// lib/ai's ChatToolCall (which only ever carries what the provider
// returned — id/name/arguments, nothing about execution). Lives here,
// alongside MessageMetadata rather than in engine/types.ts (its original
// home before Étape 8), because MessageMetadata now embeds it directly —
// engine/types.ts imports from this file, not the other way around, so
// putting it there first would have been a circular import.
export type AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "pending" | "succeeded" | "failed";
  result?: unknown;
  error?: string;
};

// Computed, never persisted as its own row — assembled from an
// AgentConversation and its recent messages (a later phase's service.ts is
// where that computation lives). Exists as a type now because it's where a
// future status-transition rule (canTransition(from, to)) belongs, rather
// than dispersed across whichever call site happens to touch `status` next.
export type ConversationState = {
  status: ConversationStatus;
  is_waiting_on_agent: boolean;
  unresolved_since: string | null;
  last_customer_message_at: string | null;
};

// The output shape of a future aggregation (an Admin Center stats screen),
// not a stored table — a contract for what that aggregation will return,
// so a later phase can't invent a slightly different shape for the same
// numbers.
export type ConversationMetrics = {
  message_count: number;
  average_latency_ms: number | null;
  total_token_usage: ChatUsage | null;
  average_sentiment_score: number | null;
  average_confidence_score: number | null;
  resolution_time_ms: number | null;
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type AgentConversation = {
  id: number;
  shop_id: number;
  customer_id: number | null;
  channel: string;
  external_thread_id: string;
  status: ConversationStatus;
  memory: ConversationMemory;
  created_at: string;
  last_message_at: string;
  resolved_at: string | null;
  escalated_at: string | null;
};

// Mirrors the ai_agents table (Phase 2) — one row per shop's agent
// configuration. Named AiAgentConfig, not AgentConfig, to stay visually
// distinct from the agent_* prefixed entities below (AgentConversation,
// AgentMessage) even though both families live in this same file; the two
// naming patterns come from two differently-prefixed tables (ai_agents vs
// agent_conversations/agent_messages), not from any inconsistency here.
// No repository/service reads this yet — that arrives once something
// actually needs to (the engine's context assembly) — this is only the
// shape that reading will return.
export type AiAgentConfig = {
  shop_id: number;
  is_active: boolean;
  system_prompt: string | null;
  tone: string;
  languages: string[];
  ai_provider: string;
  ai_model: string | null;
  enabled_tools: string[];
  // Phase 8 (RAG). Deliberately does NOT include an embedding
  // provider/model — those are a platform-wide choice (see
  // supabase/schema.sql's own comment on why), never a per-shop setting
  // like ai_provider/ai_model above. rag_top_k is null, not defaulted here
  // in TypeScript either — a null means "use the platform default", read
  // where retrieval actually happens (lib/agent/rag/retriever.ts), not
  // duplicated as a second magic number in this type.
  rag_enabled: boolean;
  rag_top_k: number | null;
};

export type AgentMessage = {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string;
  content_type: MessageContentType;
  detected_language: string | null;
  detected_intent: string | null;
  sentiment_score: number | null;
  confidence_score: number | null;
  metadata: MessageMetadata;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Context objects — assembled for the engine (a later phase), never
// persisted as their own row. Deliberately does not repeat `memory` as a
// sibling field: it is already reachable at `conversation.memory`, and a
// second copy here would be a second source of truth for the same value.
// ---------------------------------------------------------------------------

export type ConversationShopContext = {
  id: number;
  name: string;
  currency: string;
  timezone: string;
};

export type ConversationCustomerContext = {
  id: number;
  name: string | null;
  phone: string;
  email: string | null;
};

export type ConversationContext = {
  shop: ConversationShopContext;
  customer: ConversationCustomerContext | null;
  conversation: AgentConversation;
  recent_messages: AgentMessage[];
};
