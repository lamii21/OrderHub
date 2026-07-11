import type { Order } from "@/types/order";

// The closed vocabulary of business facts a workflow can react to — never
// an action to perform, always something that has already happened. Same
// "single source of truth as a const array" pattern as ORDER_STATUSES
// (lib/validation.ts). Deliberately the smallest file in the whole engine:
// no event store, no "events" table — an event is emitted and immediately
// handed to lib/workflows/dispatch.ts, never persisted for its own sake.
//
// order.paid is intentionally not included: OrderHub's ORDER_STATUSES has
// no "paid" concept today, so adding it now would be a speculative event
// with nothing real to emit it from (YAGNI) — add it once a real payment
// status exists, not before.
export const EVENT_TYPES = ["order.created", "order.status_changed", "order.cancelled"] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isValidEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

// Human-readable label for each event type — for the Workflow Builder's
// trigger dropdown or any other UI that lists event types. A plain lookup
// object, not a function with branching logic: every entry is a fixed
// string, nothing to compute. Not wired into any page yet (the current
// /shops/[id]/workflows/new form still renders the raw EventType string
// directly) — this is the label available for that to adopt later, not a
// change to that form.
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  "order.created": "Order Created",
  "order.status_changed": "Order Status Changed",
  "order.cancelled": "Order Cancelled",
};

export function getEventTypeLabel(eventType: EventType): string {
  return EVENT_TYPE_LABELS[eventType];
}

// What actually accompanies each event today — every one of them carries
// the order it happened to, nothing more (see lib/workflows/dispatch.ts's
// handleEvent(shopId, eventType, order)). A per-event-type map, not one
// flat type, so a future event that genuinely needs extra data (e.g.
// order.status_changed eventually carrying previousStatus) only widens its
// own entry instead of forcing every event to carry fields most of them
// don't have. Nothing reads this type yet — handleEvent() keeps taking a
// plain Order parameter directly; this formalizes the current shape for
// later use, it doesn't change how dispatch works today.
export type EventPayloadMap = {
  "order.created": Order;
  "order.status_changed": Order;
  "order.cancelled": Order;
};

export type EventPayload<T extends EventType = EventType> = EventPayloadMap[T];
