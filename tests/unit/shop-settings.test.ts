import { describe, it, expect } from "vitest";
import { CURRENCIES, getTimezones } from "@/lib/shop-settings";

describe("CURRENCIES", () => {
  it("is a non-empty list of unique 3-letter currency codes, including USD", () => {
    expect(CURRENCIES.length).toBeGreaterThan(0);
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
    expect(CURRENCIES).toContain("USD");
    for (const code of CURRENCIES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });
});

describe("getTimezones", () => {
  it("returns the runtime's IANA timezone list, including a well-known zone", () => {
    const timezones = getTimezones();
    expect(Array.isArray(timezones)).toBe(true);
    expect(timezones.length).toBeGreaterThan(0);
    expect(timezones).toContain("America/New_York");
  });
});
