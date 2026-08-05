import {
  findConversationById,
  insertConversationIfNew,
  insertMessage,
  listRecentMessages,
  updateConversation,
  updateMemory,
  upsertConversation,
  type InsertMessageInput,
  type UpsertConversationInput,
} from "./repository";
import { emitAgentEvent } from "../events";
import type { AgentConversation, AgentMessage, ConversationMemory, ConversationState, ConversationStatus } from "../types";

// Business rules for the conversation domain — every decision about *when*
// something happens and *what else* changes alongside it lives here, never
// in repository.ts (pure Supabase I/O) and never duplicated in a channel
// adapter or the AI engine. Every future caller — the WhatsApp webhook, any
// later channel, the AI engine — goes through this file, never
// repository.ts directly, so this logic exists in exactly one place no
// matter which channel triggered it.

const MAX_MESSAGE_LENGTH = 4000;

// A generous cap for genuine multi-paragraph conversation, well above
// lib/validation.ts's MAX_TEXT_FIELD_LENGTH (500, sized for order form
// fields, a different kind of input entirely) — this exists to reject
// abuse/runaway input, not to constrain normal conversation.
function assertValidMessageContent(content: string): void {
  if (content.trim() === "") {
    throw new Error("Message content cannot be empty.");
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message content exceeds the ${MAX_MESSAGE_LENGTH} character limit.`);
  }
}

// Find-or-create, race-free: insertConversationIfNew() either wins the
// insert (a genuinely new thread) or returns null (the thread already
// exists), so there is no window between "check" and "create" for two
// near-simultaneous messages on a brand-new thread to both think they're
// first. conversation.created fires only on the branch that actually
// created the row — never twice for the same conversation, never for a
// thread that already existed.
export async function resolveConversation(input: UpsertConversationInput): Promise<AgentConversation> {
  const created = await insertConversationIfNew(input);

  if (created) {
    await emitAgentEvent("conversation.created", { conversation: created });
    return created;
  }

  return upsertConversation(input);
}

// Appends one message and keeps last_message_at consistent with it in the
// same operation — a caller can never persist a message without the
// conversation's own "most recently active" marker also moving, which is
// what the (shop_id, last_message_at) index exists to sort by.
export async function appendMessage(input: InsertMessageInput): Promise<AgentMessage> {
  assertValidMessageContent(input.content);

  const message = await insertMessage(input);
  const conversation = await updateConversation(input.conversation_id, {
    last_message_at: message.created_at,
  });

  await emitAgentEvent("conversation.message_received", { conversation, message });

  return message;
}

// Centralizes which fields change together for a given status — resolving
// a conversation always stamps resolved_at in the same call, escalating
// always stamps escalated_at, so no caller can set one without the other.
// Accepts any status -> status transition today; no transition is rejected,
// because no such rule has been specified yet (see this step's own report
// for why inventing one now would be an unvalidated product decision, not
// an architecture one). This is still the one seam a real canTransition()
// guard will attach to later, without any caller needing to change.
export async function transitionConversationStatus(
  conversationId: number,
  toStatus: ConversationStatus
): Promise<AgentConversation> {
  const now = new Date().toISOString();

  const conversation = await updateConversation(conversationId, {
    status: toStatus,
    ...(toStatus === "resolved" && { resolved_at: now }),
    ...(toStatus === "escalated" && { escalated_at: now }),
  });

  if (toStatus === "resolved") {
    await emitAgentEvent("conversation.resolved", { conversation });
  } else if (toStatus === "escalated") {
    await emitAgentEvent("conversation.escalated", { conversation });
  }

  return conversation;
}

const MAX_MEMORY_UPDATE_ATTEMPTS = 3;

// The concurrency control this step exists to provide: `updater` receives
// the *current* memory (re-read fresh on every attempt, never the caller's
// possibly-stale copy) and returns the next content: a transformation, not
// a value. On a version conflict (repository.updateMemory returning null —
// another write moved the version forward first), this re-reads the new
// current state and re-applies `updater` to it, rather than overwriting
// whatever the concurrent write just committed. Gives up after
// MAX_MEMORY_UPDATE_ATTEMPTS — the same bounded-retry posture already used
// by lib/platforms/retry.ts's fetchWithRetry, applied here to a database
// conflict instead of an HTTP 429.
export async function updateConversationMemory(
  conversationId: number,
  updater: (current: ConversationMemory) => Omit<ConversationMemory, "version">
): Promise<AgentConversation> {
  for (let attempt = 0; attempt < MAX_MEMORY_UPDATE_ATTEMPTS; attempt++) {
    const current = await findConversationById(conversationId);

    if (!current) {
      throw new Error(`Cannot update memory: conversation ${conversationId} does not exist.`);
    }

    const nextContent = updater(current.memory);
    const updated = await updateMemory(conversationId, nextContent, current.memory.version);

    if (updated) {
      return updated;
    }
  }

  throw new Error(
    `Could not update memory for conversation ${conversationId} after ${MAX_MEMORY_UPDATE_ATTEMPTS} attempts — too many concurrent writes.`
  );
}

// Pure facades over repository.ts's reads — the AI engine (a later phase)
// must never import repository.ts directly (this project's own rule for
// this subsystem), so every read it needs is exposed here too, not just
// the writes. Delegation only: there is no business rule to add to a plain
// read by id or by recency.
export async function getConversation(conversationId: number): Promise<AgentConversation | null> {
  return findConversationById(conversationId);
}

export async function getRecentMessages(conversationId: number, limit: number): Promise<AgentMessage[]> {
  return listRecentMessages(conversationId, limit);
}

// Computed, never persisted — turns an already-loaded conversation and its
// recent messages into the derived ConversationState types.ts already
// reserves for this. Pure: no I/O of its own, so a caller who already has
// both pieces (the engine, in a later phase) never pays for a second query
// just to know whose turn it is to reply.
export function computeConversationState(
  conversation: AgentConversation,
  recentMessages: AgentMessage[]
): ConversationState {
  let lastCustomerMessage: AgentMessage | null = null;
  let lastAssistantMessage: AgentMessage | null = null;

  for (const message of recentMessages) {
    if (message.role === "user") {
      lastCustomerMessage = message;
    } else if (message.role === "assistant") {
      lastAssistantMessage = message;
    }
  }

  const isWaitingOnAgent =
    lastCustomerMessage !== null &&
    (lastAssistantMessage === null ||
      new Date(lastCustomerMessage.created_at).getTime() > new Date(lastAssistantMessage.created_at).getTime());

  return {
    status: conversation.status,
    is_waiting_on_agent: isWaitingOnAgent,
    unresolved_since: conversation.status !== "resolved" ? conversation.created_at : null,
    last_customer_message_at: lastCustomerMessage?.created_at ?? null,
  };
}
