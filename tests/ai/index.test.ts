import { describe, it, expect } from "vitest";
import { getChatProvider, getEmbeddingProvider, SUPPORTED_CHAT_PROVIDERS, SUPPORTED_EMBEDDING_PROVIDERS } from "@/lib/ai";
import { UnsupportedEmbeddingError } from "@/lib/ai/errors";

describe("getChatProvider", () => {
  it("resolves a registered provider by name", () => {
    expect(getChatProvider("openrouter").name).toBe("openrouter");
  });

  it("throws a plain Error for an unregistered name", () => {
    expect(() => getChatProvider("does-not-exist")).toThrow('No chat provider registered for "does-not-exist"');
  });
});

describe("getEmbeddingProvider", () => {
  it("resolves a registered embedding provider by name", () => {
    expect(getEmbeddingProvider("gemini").name).toBe("gemini");
  });

  it("throws UnsupportedEmbeddingError for a name that IS a real chat provider, just not an embedding one", () => {
    expect(() => getEmbeddingProvider("openrouter")).toThrow(UnsupportedEmbeddingError);
  });

  it("throws a plain Error (not UnsupportedEmbeddingError) for a name that isn't registered anywhere", () => {
    expect(() => getEmbeddingProvider("does-not-exist")).not.toThrow(UnsupportedEmbeddingError);
    expect(() => getEmbeddingProvider("does-not-exist")).toThrow('No embedding provider registered for "does-not-exist"');
  });
});

describe("SUPPORTED_CHAT_PROVIDERS / SUPPORTED_EMBEDDING_PROVIDERS", () => {
  it("lists exactly the registered chat providers", () => {
    expect(SUPPORTED_CHAT_PROVIDERS).toEqual(["openrouter"]);
  });

  it("lists exactly the registered embedding providers", () => {
    expect(SUPPORTED_EMBEDDING_PROVIDERS).toEqual(["gemini"]);
  });
});
