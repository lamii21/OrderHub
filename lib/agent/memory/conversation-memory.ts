import { findConversationById, updateMemory } from "../conversation/repository";
import type { AgentConversation, ConversationMemory } from "../types";

// Everything about reading and changing a conversation's structured
// memory — separate from conversation/service.ts, which owns the
// conversation's *lifecycle* (created, message received, status) rather
// than the *content* of what it remembers. The concurrency control lives
// here because it belongs to the thing being versioned (memory), not to
// the conversation entity that merely holds a reference to it — same
// reasoning types.ts's own comment already gives for bundling `version`
// inside ConversationMemory instead of on AgentConversation directly.

const MAX_MEMORY_UPDATE_ATTEMPTS = 3;

// The one place any part of memory is ever written. `updater` receives the
// *current* memory (re-read fresh on every attempt, never a caller's
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

// A plain read — no business rule beyond "memory lives on the
// conversation", but exposed here (rather than forcing every caller to go
// through conversation/service.ts for a memory-shaped question) so a
// caller only interested in memory never has to import the conversation
// lifecycle module just to read it.
export async function getConversationMemory(conversationId: number): Promise<ConversationMemory | null> {
  const conversation = await findConversationById(conversationId);
  return conversation ? conversation.memory : null;
}

// Named, intent-expressing operations built on updateConversationMemory
// rather than every future caller (the AI engine, a later phase)
// constructing its own ad-hoc updater function. Each one only touches the
// facet of memory it's named for — updating the summary can never
// accidentally drop a previously-recorded fact or preference, because
// every updater spreads `current` first.

export async function updateSummary(conversationId: number, summary: string): Promise<AgentConversation> {
  return updateConversationMemory(conversationId, (current) => ({
    ...current,
    summary,
    summary_updated_at: new Date().toISOString(),
  }));
}

export async function setFact(conversationId: number, key: string, value: unknown): Promise<AgentConversation> {
  return updateConversationMemory(conversationId, (current) => ({
    ...current,
    facts: { ...current.facts, [key]: value },
  }));
}

export async function setPreference(conversationId: number, key: string, value: unknown): Promise<AgentConversation> {
  return updateConversationMemory(conversationId, (current) => ({
    ...current,
    preferences: { ...current.preferences, [key]: value },
  }));
}
