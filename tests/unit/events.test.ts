import { describe, it, expect } from "vitest";
import { EVENT_TYPES, isValidEventType, EVENT_TYPE_LABELS, getEventTypeLabel } from "@/lib/events/types";

describe("EVENT_TYPES / isValidEventType", () => {
  it.each(EVENT_TYPES)("accepts %s", (eventType) => {
    expect(isValidEventType(eventType)).toBe(true);
  });

  it("rejects an event not in the closed vocabulary", () => {
    expect(isValidEventType("order.paid")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidEventType(123)).toBe(false);
    expect(isValidEventType(null)).toBe(false);
  });
});

describe("getEventTypeLabel / EVENT_TYPE_LABELS", () => {
  it.each(EVENT_TYPES)("has a label for %s", (eventType) => {
    expect(getEventTypeLabel(eventType)).toBe(EVENT_TYPE_LABELS[eventType]);
    expect(typeof getEventTypeLabel(eventType)).toBe("string");
    expect(getEventTypeLabel(eventType).length).toBeGreaterThan(0);
  });

  it("has exactly one label per event type, no more and no fewer", () => {
    expect(Object.keys(EVENT_TYPE_LABELS).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("returns a human-readable label, not the raw dotted event string", () => {
    expect(getEventTypeLabel("order.created")).toBe("Order Created");
    expect(getEventTypeLabel("order.created")).not.toContain(".");
  });
});
