import type { AgentConversation, AgentMessage } from "./types";

// A lightweight, in-process pub/sub for conversation lifecycle events — not
// a second copy of lib/events/types.ts's workflow events. That file backs a
// single, direct call chain (an order.created event always resolves to
// exactly one dispatch: lib/workflows/dispatch.ts's handleEvent). This one
// exists because several independent things will eventually need to react
// to the same conversation event (trigger a workflow, notify the merchant,
// record a metric) without lib/agent/conversation/ or lib/agent/memory/
// ever importing any of them directly — the dependency runs the other way:
// a later phase's bridge code calls onAgentEvent() to listen, this module
// never calls into lib/workflows/ or anywhere else itself.
//
// No event store, no persisted table, same as lib/events/types.ts's own
// stance — an event is emitted and handed straight to whatever is
// currently subscribed, never kept for its own sake.
export const AGENT_EVENT_TYPES = [
  "conversation.created",
  "conversation.message_received",
  "conversation.resolved",
  "conversation.escalated",
  "conversation.sentiment_negative",
  "conversation.abandoned",
  "conversation.started",
  "conversation.responded",
  "conversation.completed",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

// Every event carries the full entity(ies) involved, not just an id — the
// caller emitting the event already has them in hand (it just
// created/updated the row), so a subscriber never has to re-fetch what its
// emitter already knew. Same "pass what you already have" posture as
// dispatch.handleEvent(shopId, eventType, order: Order).
export type AgentEventPayloadMap = {
  "conversation.created": { conversation: AgentConversation };
  "conversation.message_received": { conversation: AgentConversation; message: AgentMessage };
  "conversation.resolved": { conversation: AgentConversation };
  "conversation.escalated": { conversation: AgentConversation };
  "conversation.sentiment_negative": { conversation: AgentConversation; message: AgentMessage };
  "conversation.abandoned": { conversation: AgentConversation };
  // The engine's own lifecycle (lib/agent/engine/execute.ts), distinct from
  // the conversation-domain events above even though "started"/"responded"
  // carry the same shape as "message_received" today. "responded" and
  // "completed" share one payload shape for now (Phase 5 has no Tool
  // Calling yet, so one turn produces exactly one persisted reply), but stay
  // two separate event types because that stops being true once Tool
  // Calling (a later phase) exists: "responded" will fire once per
  // persisted reply within a turn (there may be intermediate ones around
  // tool round-trips), "completed" exactly once, when the whole turn is
  // done. Deliberately excludes latency_ms or any other observability data
  // — that already lives on message.metadata, and these events stay about
  // what happened in the domain, not how long it took.
  "conversation.started": { conversation: AgentConversation };
  "conversation.responded": { conversation: AgentConversation; message: AgentMessage };
  "conversation.completed": { conversation: AgentConversation; message: AgentMessage };
};

export type AgentEventPayload<T extends AgentEventType = AgentEventType> = AgentEventPayloadMap[T];

type AgentEventHandler<T extends AgentEventType> = (payload: AgentEventPayload<T>) => void | Promise<void>;

// Module-level, per-process state — deliberately not persisted, not shared
// across serverless instances, same scope as lib/rate-limit.ts's own
// in-memory state. A handler registered by one request has no bearing on
// another; subscribers are expected to be wired up once, at module load
// time (a later phase's bridge from events to lib/workflows/dispatch.ts),
// not per-request.
const handlers = new Map<AgentEventType, Set<AgentEventHandler<AgentEventType>>>();

export function onAgentEvent<T extends AgentEventType>(eventType: T, handler: AgentEventHandler<T>): void {
  const existing = handlers.get(eventType);
  const set = existing ?? new Set<AgentEventHandler<AgentEventType>>();
  set.add(handler as AgentEventHandler<AgentEventType>);

  if (!existing) {
    handlers.set(eventType, set);
  }
}

// Runs every subscriber for this event type in order, never letting one
// handler's failure stop the rest — the same isolated-failure posture
// lib/workflows/engine.ts's runSteps() already applies per workflow step.
// A caller that wants to know a handler failed still can: the error is
// logged here, but emitAgentEvent() itself never rejects because one
// subscriber misbehaved.
export async function emitAgentEvent<T extends AgentEventType>(
  eventType: T,
  payload: AgentEventPayload<T>
): Promise<void> {
  const subscribers = handlers.get(eventType);

  if (!subscribers || subscribers.size === 0) {
    return;
  }

  for (const handler of subscribers) {
    try {
      await handler(payload as AgentEventPayload<AgentEventType>);
    } catch (err) {
      console.error(`emitAgentEvent: a subscriber to "${eventType}" failed:`, err);
    }
  }
}

// Test-only escape hatch — same __-prefixed convention already used by
// lib/rate-limit.ts's __resetRateLimitState(), called from a test's
// beforeEach so one test's subscribers can never leak into the next.
export function __resetAgentEventHandlers(): void {
  handlers.clear();
}
