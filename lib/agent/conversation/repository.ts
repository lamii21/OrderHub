import { supabase } from "@/lib/supabase";
import type {
  AgentConversation,
  AgentMessage,
  ConversationMemory,
  ConversationStatus,
  MessageContentType,
  MessageMetadata,
  MessageRole,
} from "../types";

// Pure Supabase I/O — every function here is a direct translation of one
// query or write, nothing else. No status-transition rules, no validation
// beyond what TypeScript's own types already guarantee, no orchestration
// across more than one table. That belongs to service.ts (a later step),
// which is what the AI engine, the WhatsApp webhook, and every future
// channel are meant to call — never this file directly — so that logic
// exists in exactly one place no matter which channel triggered it.

type ConversationRow = {
  id: number;
  shop_id: number;
  customer_id: number | null;
  channel: string;
  external_thread_id: string;
  status: ConversationStatus;
  memory: Record<string, unknown> | null;
  memory_version: number;
  created_at: string;
  last_message_at: string;
  resolved_at: string | null;
  escalated_at: string | null;
};

type MessageRow = {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string;
  content_type: MessageContentType;
  detected_language: string | null;
  detected_intent: string | null;
  sentiment_score: number | null;
  confidence_score: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

// The one place `memory` (jsonb) and `memory_version` (integer) — two
// columns, for the query-cost/optimistic-locking reasons types.ts's own
// comment already explains — become the one ConversationMemory value
// object every caller outside this file actually works with.
function mapRowToConversation(row: ConversationRow): AgentConversation {
  const memoryContent = (row.memory ?? {}) as Omit<ConversationMemory, "version">;

  return {
    id: row.id,
    shop_id: row.shop_id,
    customer_id: row.customer_id,
    channel: row.channel,
    external_thread_id: row.external_thread_id,
    status: row.status,
    memory: { ...memoryContent, version: row.memory_version },
    created_at: row.created_at,
    last_message_at: row.last_message_at,
    resolved_at: row.resolved_at,
    escalated_at: row.escalated_at,
  };
}

function mapRowToMessage(row: MessageRow): AgentMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    content_type: row.content_type,
    detected_language: row.detected_language,
    detected_intent: row.detected_intent,
    sentiment_score: row.sentiment_score,
    confidence_score: row.confidence_score,
    metadata: (row.metadata ?? {}) as MessageMetadata,
    created_at: row.created_at,
  };
}

export type UpsertConversationInput = {
  shop_id: number;
  channel: string;
  external_thread_id: string;
  // Omitted entirely = leave whatever customer_id an existing row already
  // has untouched on conflict; an explicit `null` clears it. Same
  // omitted-vs-null convention lib/customer.ts's CustomerInput already
  // uses for name/city/address/email — not a new one invented here.
  customer_id?: number | null;
};

// Atomic find-or-create on the (shop_id, channel, external_thread_id)
// unique index (supabase/schema.sql) — a plain upsert, not a
// select-then-insert, so two near-simultaneous messages on a brand-new
// thread can never race into two rows for the same conversation. On
// conflict, only the columns actually present in this payload are
// touched — status/memory/timestamps on an existing row are never reset
// just because the same thread received another message.
export async function upsertConversation(input: UpsertConversationInput): Promise<AgentConversation> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .upsert(
      {
        shop_id: input.shop_id,
        channel: input.channel,
        external_thread_id: input.external_thread_id,
        ...(input.customer_id !== undefined && { customer_id: input.customer_id }),
      },
      { onConflict: "shop_id,channel,external_thread_id" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRowToConversation(data);
}

// Same unique index as upsertConversation, but with ignoreDuplicates: true
// — returns the new row only when this call is the one that actually won
// the insert, null when the thread already existed. This is what lets
// service.ts's resolveConversation() know whether it just created a
// conversation (to emit conversation.created) without a separate find
// first, which would leave a race window between the check and the write.
// Same two-phase upsert shape already proven in app/api/orders/route.ts
// for the exact same "was this genuinely new" question.
export async function insertConversationIfNew(input: UpsertConversationInput): Promise<AgentConversation | null> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .upsert(
      {
        shop_id: input.shop_id,
        channel: input.channel,
        external_thread_id: input.external_thread_id,
        ...(input.customer_id !== undefined && { customer_id: input.customer_id }),
      },
      { onConflict: "shop_id,channel,external_thread_id", ignoreDuplicates: true }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapRowToConversation(data as ConversationRow) : null;
}

export async function findConversationById(conversationId: number): Promise<AgentConversation | null> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapRowToConversation(data as ConversationRow) : null;
}

export type ConversationPatch = Partial<{
  status: ConversationStatus;
  resolved_at: string | null;
  escalated_at: string | null;
  last_message_at: string;
  customer_id: number | null;
}>;

// A plain, unconditional patch — whatever the caller puts in `patch` is
// written as-is. Deciding *which* fields belong together (e.g. that
// resolving a conversation means status AND resolved_at change in the same
// call) is a service.ts decision; this function has no opinion on that.
export async function updateConversation(
  conversationId: number,
  patch: ConversationPatch
): Promise<AgentConversation> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .update(patch)
    .eq("id", conversationId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRowToConversation(data);
}

// Optimistic concurrency on memory_version: the write only takes effect if
// the row's version still matches `expectedVersion` at the moment Postgres
// evaluates the WHERE clause — a single conditional UPDATE, not a
// read-then-write round trip (the exact TOCTOU shape this project has
// already been burned by once this session, for shops.sheet_id). Returns
// null when nothing matched (a conflicting write already moved the version
// forward) rather than throwing — a version conflict is an expected
// outcome for the caller to react to, not an error condition.
export async function updateMemory(
  conversationId: number,
  content: Omit<ConversationMemory, "version">,
  expectedVersion: number
): Promise<AgentConversation | null> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .update({ memory: content, memory_version: expectedVersion + 1 })
    .eq("id", conversationId)
    .eq("memory_version", expectedVersion)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapRowToConversation(data as ConversationRow) : null;
}

export type InsertMessageInput = {
  conversation_id: number;
  role: MessageRole;
  content: string;
  content_type?: MessageContentType;
  detected_language?: string | null;
  detected_intent?: string | null;
  sentiment_score?: number | null;
  confidence_score?: number | null;
  metadata?: MessageMetadata;
};

export async function insertMessage(input: InsertMessageInput): Promise<AgentMessage> {
  const { data, error } = await supabase
    .from("agent_messages")
    .insert({
      conversation_id: input.conversation_id,
      role: input.role,
      content: input.content,
      ...(input.content_type !== undefined && { content_type: input.content_type }),
      ...(input.detected_language !== undefined && { detected_language: input.detected_language }),
      ...(input.detected_intent !== undefined && { detected_intent: input.detected_intent }),
      ...(input.sentiment_score !== undefined && { sentiment_score: input.sentiment_score }),
      ...(input.confidence_score !== undefined && { confidence_score: input.confidence_score }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRowToMessage(data);
}

// Returns oldest-first (natural reading order) — the query itself has to
// fetch newest-first to LIMIT correctly to "the last N", so the result is
// reversed once, in memory, before it ever reaches a caller. Every future
// caller (the engine building an LLM prompt, an admin UI rendering a
// thread) wants chronological order; none of them should have to
// remember to reverse it themselves.
export async function listRecentMessages(conversationId: number, limit: number): Promise<AgentMessage[]> {
  const { data, error } = await supabase
    .from("agent_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as MessageRow[]).map(mapRowToMessage).reverse();
}
