import { describe, it, expect } from "vitest";
import {
  requireNonEmptyString,
  requireOneOf,
  requireValidUrl,
  requireWithinLength,
} from "@/lib/automation-modules/validation";

describe("requireNonEmptyString", () => {
  it("returns null for a non-empty string", () => {
    expect(requireNonEmptyString("hello", "Template")).toBeNull();
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(requireNonEmptyString("", "Template")).toMatch(/Template/);
    expect(requireNonEmptyString("   ", "Template")).toMatch(/Template/);
  });

  it("rejects a non-string value", () => {
    expect(requireNonEmptyString(123, "Template")).toMatch(/non-empty string/);
    expect(requireNonEmptyString(undefined, "Template")).toMatch(/non-empty string/);
    expect(requireNonEmptyString(null, "Template")).toMatch(/non-empty string/);
  });

  it("includes the field label in the error message", () => {
    expect(requireNonEmptyString(undefined, "Carrier")).toContain("Carrier");
  });
});

describe("requireOneOf", () => {
  const carriers = ["generic-webhook", "dhl", "fedex"] as const;

  it("returns null for a value in the allowed list", () => {
    expect(requireOneOf("dhl", carriers, "Carrier")).toBeNull();
  });

  it("rejects a value outside the allowed list", () => {
    expect(requireOneOf("ups", carriers, "Carrier")).toMatch(/Carrier must be one of/);
  });

  it("rejects a non-string value", () => {
    expect(requireOneOf(123, carriers, "Carrier")).toMatch(/must be one of/);
  });

  it("lists every allowed value in the error message", () => {
    const error = requireOneOf("ups", carriers, "Carrier")!;
    for (const carrier of carriers) {
      expect(error).toContain(carrier);
    }
  });
});

describe("requireValidUrl", () => {
  it("returns null for a public https URL", () => {
    expect(requireValidUrl("https://example.com/hook", "Webhook URL")).toBeNull();
  });

  it("rejects a non-string value", () => {
    expect(requireValidUrl(123, "Webhook URL")).toMatch(/valid http\(s\) URL/);
  });

  it("rejects a non-URL string", () => {
    expect(requireValidUrl("not a url", "Webhook URL")).toMatch(/not allowed/);
  });

  it("rejects a URL pointing at a private/internal address (SSRF guard)", () => {
    expect(requireValidUrl("http://169.254.169.254/steal", "Webhook URL")).toMatch(
      /not allowed/
    );
  });

  it("includes the field label in the error message", () => {
    expect(requireValidUrl(123, "Carrier webhook")).toContain("Carrier webhook");
  });

  // requireValidUrl is synchronous (matching validateConfig()'s own
  // synchronous contract), so it can only ever run checkUrlSafetySync's
  // synchronous subset (protocol + a literal private IP) — a hostname
  // that merely resolves to a private address needs the async
  // assertPublicHttpUrl check at the point a module actually makes the
  // request instead (see tests/unit/net-guard.test.ts's own coverage of
  // that DNS-resolving path). A plain ordinary hostname is accepted here
  // even though it hasn't been DNS-checked yet.
  it("accepts an ordinary hostname without resolving it (the sync check alone decides here)", () => {
    expect(requireValidUrl("https://internal.example.com/hook", "Webhook URL")).toBeNull();
  });
});

describe("requireWithinLength", () => {
  it("returns null when the value is within the limit", () => {
    expect(requireWithinLength("short", 10, "Message")).toBeNull();
  });

  it("returns null when the value is exactly at the limit", () => {
    expect(requireWithinLength("1234567890", 10, "Message")).toBeNull();
  });

  it("rejects a value longer than the limit", () => {
    expect(requireWithinLength("12345678901", 10, "Message")).toMatch(/too long \(max 10/);
  });

  it("includes the field label in the error message", () => {
    expect(requireWithinLength("x".repeat(20), 10, "Note content")).toContain("Note content");
  });
});
