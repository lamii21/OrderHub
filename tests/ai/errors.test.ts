import { describe, it, expect } from "vitest";
import {
  AiProviderError,
  AiAuthenticationError,
  AiTimeoutError,
  AiRateLimitError,
  AiValidationError,
  UnsupportedEmbeddingError,
} from "@/lib/ai/errors";

describe("AI provider error hierarchy", () => {
  it.each([
    ["AiAuthenticationError", () => new AiAuthenticationError("openrouter")],
    ["AiTimeoutError", () => new AiTimeoutError("openrouter", 30_000)],
    ["AiRateLimitError", () => new AiRateLimitError("openrouter")],
    ["AiValidationError", () => new AiValidationError("openrouter", "bad request")],
    ["UnsupportedEmbeddingError", () => new UnsupportedEmbeddingError("openrouter")],
  ])("%s is an instance of both itself and the shared AiProviderError base", (_label, build) => {
    const err = build();
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err).toBeInstanceOf(Error);
  });

  it("carries the provider name so a caller never has to re-derive it", () => {
    const err = new AiAuthenticationError("openrouter");
    expect(err.provider).toBe("openrouter");
  });

  it("AiRateLimitError carries retryAfterSeconds when given, undefined otherwise", () => {
    expect(new AiRateLimitError("openrouter", 12).retryAfterSeconds).toBe(12);
    expect(new AiRateLimitError("openrouter").retryAfterSeconds).toBeUndefined();
  });

  it("preserves a wrapped cause on the base class", () => {
    const original = new Error("socket hang up");
    const err = new AiProviderError("network error", "openrouter", { cause: original });
    expect(err.cause).toBe(original);
  });

  it("lets a caller branch on error type rather than parsing message text", () => {
    const errors: AiProviderError[] = [
      new AiAuthenticationError("openrouter"),
      new AiRateLimitError("openrouter", 5),
      new AiTimeoutError("openrouter", 30_000),
    ];

    const kinds = errors.map((err) => {
      if (err instanceof AiAuthenticationError) return "auth";
      if (err instanceof AiRateLimitError) return "rate-limit";
      if (err instanceof AiTimeoutError) return "timeout";
      return "other";
    });

    expect(kinds).toEqual(["auth", "rate-limit", "timeout"]);
  });
});
