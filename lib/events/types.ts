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
