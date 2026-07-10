import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireEnv, matchesAnySecret } from "@/lib/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("requireEnv", () => {
  it("returns the value when set", () => {
    process.env.SOME_TEST_VAR = "hello";
    expect(requireEnv("SOME_TEST_VAR")).toBe("hello");
  });

  it("throws a descriptive error when missing", () => {
    delete process.env.SOME_MISSING_VAR;
    expect(() => requireEnv("SOME_MISSING_VAR")).toThrow(/SOME_MISSING_VAR/);
  });
});

describe("matchesAnySecret", () => {
  beforeEach(() => {
    process.env.PRIMARY_SECRET = "correct-horse-battery-staple";
    delete process.env.PRIMARY_SECRET_PREVIOUS;
  });

  it("matches the primary secret", () => {
    expect(matchesAnySecret("correct-horse-battery-staple", "PRIMARY_SECRET")).toBe(true);
  });

  it("rejects a wrong value", () => {
    expect(matchesAnySecret("wrong-value", "PRIMARY_SECRET")).toBe(false);
  });

  it("rejects null", () => {
    expect(matchesAnySecret(null, "PRIMARY_SECRET")).toBe(false);
  });

  it("supports rotation via a second env var", () => {
    process.env.PRIMARY_SECRET_PREVIOUS = "old-secret";
    expect(matchesAnySecret("old-secret", "PRIMARY_SECRET", "PRIMARY_SECRET_PREVIOUS")).toBe(
      true
    );
    expect(matchesAnySecret("correct-horse-battery-staple", "PRIMARY_SECRET", "PRIMARY_SECRET_PREVIOUS")).toBe(
      true
    );
  });

  it("ignores an unset rotation var instead of matching an empty string", () => {
    expect(matchesAnySecret("", "PRIMARY_SECRET", "PRIMARY_SECRET_PREVIOUS")).toBe(false);
  });

  it("is not fooled by differing lengths (no substring/prefix match)", () => {
    expect(matchesAnySecret("correct-horse-battery-staple-extra", "PRIMARY_SECRET")).toBe(false);
    expect(matchesAnySecret("correct", "PRIMARY_SECRET")).toBe(false);
  });
});
