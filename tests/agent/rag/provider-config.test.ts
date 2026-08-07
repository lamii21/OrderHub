import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getEmbeddingProvider } = vi.hoisted(() => ({ getEmbeddingProvider: vi.fn() }));

vi.mock("@/lib/ai", () => ({ getEmbeddingProvider }));

import { resolvePlatformEmbeddingProvider } from "@/lib/agent/rag/provider-config";

const ORIGINAL_ENV = { ...process.env };
const fakeProvider = { name: "gemini", capabilities: {}, embed: vi.fn() };

beforeEach(() => {
  getEmbeddingProvider.mockReset().mockReturnValue(fakeProvider);
  process.env.RAG_EMBEDDING_PROVIDER = "gemini";
  process.env.RAG_EMBEDDING_MODEL = "text-embedding-004";
  process.env.RAG_EMBEDDING_API_KEY = "test-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolvePlatformEmbeddingProvider", () => {
  it("resolves the provider named by RAG_EMBEDDING_PROVIDER and builds credentials from the environment", () => {
    const result = resolvePlatformEmbeddingProvider();

    expect(getEmbeddingProvider).toHaveBeenCalledWith("gemini");
    expect(result).toEqual({
      provider: fakeProvider,
      credentials: { apiKey: "test-key", model: "text-embedding-004" },
    });
  });

  it("throws immediately when RAG_EMBEDDING_PROVIDER is missing", () => {
    delete process.env.RAG_EMBEDDING_PROVIDER;
    expect(() => resolvePlatformEmbeddingProvider()).toThrow(/RAG_EMBEDDING_PROVIDER/);
    expect(getEmbeddingProvider).not.toHaveBeenCalled();
  });

  it("throws immediately when RAG_EMBEDDING_API_KEY is missing", () => {
    delete process.env.RAG_EMBEDDING_API_KEY;
    expect(() => resolvePlatformEmbeddingProvider()).toThrow(/RAG_EMBEDDING_API_KEY/);
  });

  it("throws immediately when RAG_EMBEDDING_MODEL is missing", () => {
    delete process.env.RAG_EMBEDDING_MODEL;
    expect(() => resolvePlatformEmbeddingProvider()).toThrow(/RAG_EMBEDDING_MODEL/);
  });

  it("propagates an unknown/unsupported provider name error from getEmbeddingProvider", () => {
    getEmbeddingProvider.mockImplementation(() => {
      throw new Error('No embedding provider registered for "gemini"');
    });

    expect(() => resolvePlatformEmbeddingProvider()).toThrow('No embedding provider registered for "gemini"');
  });
});
