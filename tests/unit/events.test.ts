import { describe, it, expect } from "vitest";
import { EVENT_TYPES, isValidEventType } from "@/lib/events/types";

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
