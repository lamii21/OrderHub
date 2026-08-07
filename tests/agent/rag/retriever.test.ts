import { describe, it, expect, vi, beforeEach } from "vitest";

const { searchSimilarChunks, resolvePlatformEmbeddingProvider, embed } = vi.hoisted(() => ({
  searchSimilarChunks: vi.fn(),
  resolvePlatformEmbeddingProvider: vi.fn(),
  embed: vi.fn(),
}));

vi.mock("@/lib/agent/rag/repository", () => ({ searchSimilarChunks }));
vi.mock("@/lib/agent/rag/provider-config", () => ({ resolvePlatformEmbeddingProvider }));

import { retrieveRelevantChunks, DEFAULT_RAG_TOP_K } from "@/lib/agent/rag/retriever";

const credentials = { apiKey: "test-key", model: "text-embedding-004" };

function chunk(overrides: Partial<{ document_id: number; document_type: string; document_title: string; content: string; similarity: number }> = {}) {
  return {
    document_id: 1,
    document_type: "faq",
    document_title: "Livraison",
    content: "Nous livrons partout au Maroc.",
    similarity: 0.9,
    ...overrides,
  };
}

beforeEach(() => {
  embed.mockReset().mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: "text-embedding-004" });
  resolvePlatformEmbeddingProvider.mockReset().mockReturnValue({ provider: { embed }, credentials });
  searchSimilarChunks.mockReset().mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("retrieveRelevantChunks — happy path", () => {
  it("embeds the query and searches with the default top-k when none is given", async () => {
    await retrieveRelevantChunks(15, "livraison delai");

    expect(embed).toHaveBeenCalledWith(credentials, "livraison delai");
    expect(searchSimilarChunks).toHaveBeenCalledWith(15, [0.1, 0.2, 0.3], DEFAULT_RAG_TOP_K);
  });

  it("respects an explicit top-k", async () => {
    await retrieveRelevantChunks(15, "livraison", 8);
    expect(searchSimilarChunks).toHaveBeenCalledWith(15, [0.1, 0.2, 0.3], 8);
  });

  it("maps a matching chunk to the safe RetrievedChunk shape, no internal ids", async () => {
    searchSimilarChunks.mockResolvedValue([chunk()]);

    const result = await retrieveRelevantChunks(15, "livraison");

    expect(result).toEqual([
      { document_type: "faq", title: "Livraison", content: "Nous livrons partout au Maroc.", score: 0.9 },
    ]);
  });

  it("trims the query before embedding, and never searches for an empty query", async () => {
    await retrieveRelevantChunks(15, "   ");

    expect(embed).not.toHaveBeenCalled();
    expect(searchSimilarChunks).not.toHaveBeenCalled();
  });
});

describe("retrieveRelevantChunks — seuil de pertinence", () => {
  it("drops a chunk below the relevance threshold", async () => {
    searchSimilarChunks.mockResolvedValue([chunk({ similarity: 0.4 })]);

    await expect(retrieveRelevantChunks(15, "livraison")).resolves.toEqual([]);
  });

  it("keeps a chunk exactly at the threshold", async () => {
    searchSimilarChunks.mockResolvedValue([chunk({ similarity: 0.75 })]);

    await expect(retrieveRelevantChunks(15, "livraison")).resolves.toHaveLength(1);
  });
});

describe("retrieveRelevantChunks — déduplication et limite de contexte", () => {
  it("caps at most 2 chunks from the same document", async () => {
    searchSimilarChunks.mockResolvedValue([
      chunk({ content: "chunk 1" }),
      chunk({ content: "chunk 2" }),
      chunk({ content: "chunk 3" }),
    ]);

    const result = await retrieveRelevantChunks(15, "livraison");

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.content)).toEqual(["chunk 1", "chunk 2"]);
  });

  it("keeps chunks from different documents even past the per-document cap", async () => {
    searchSimilarChunks.mockResolvedValue([
      chunk({ document_id: 1, content: "doc1 chunk1" }),
      chunk({ document_id: 1, content: "doc1 chunk2" }),
      chunk({ document_id: 2, content: "doc2 chunk1" }),
    ]);

    const result = await retrieveRelevantChunks(15, "livraison");

    expect(result.map((c) => c.content)).toEqual(["doc1 chunk1", "doc1 chunk2", "doc2 chunk1"]);
  });

  it("stops once the total content length budget is exhausted, without picking a smaller later chunk instead", async () => {
    searchSimilarChunks.mockResolvedValue([
      chunk({ document_id: 1, content: "a".repeat(3999) }),
      chunk({ document_id: 2, content: "b".repeat(10) }),
      chunk({ document_id: 3, content: "c".repeat(1) }),
    ]);

    const result = await retrieveRelevantChunks(15, "livraison");

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("a".repeat(3999));
  });
});

describe("retrieveRelevantChunks — jamais d'échec de la conversation", () => {
  it("returns an empty array, never throws, when the platform embedding config is missing", async () => {
    resolvePlatformEmbeddingProvider.mockImplementation(() => {
      throw new Error("Missing required environment variable: RAG_EMBEDDING_PROVIDER.");
    });

    await expect(retrieveRelevantChunks(15, "livraison")).resolves.toEqual([]);
  });

  it("returns an empty array, never throws, when the embedding call fails", async () => {
    embed.mockRejectedValue(new Error("rate limit exceeded"));

    await expect(retrieveRelevantChunks(15, "livraison")).resolves.toEqual([]);
  });

  it("returns an empty array, never throws, when the vector search itself fails", async () => {
    searchSimilarChunks.mockRejectedValue(new Error("db down"));

    await expect(retrieveRelevantChunks(15, "livraison")).resolves.toEqual([]);
  });
});
