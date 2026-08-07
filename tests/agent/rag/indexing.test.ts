import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findDocumentById,
  listDocumentsByShop,
  deleteChunksForDocument,
  insertChunks,
  chunkText,
  resolvePlatformEmbeddingProvider,
  embed,
} = vi.hoisted(() => ({
  findDocumentById: vi.fn(),
  listDocumentsByShop: vi.fn(),
  deleteChunksForDocument: vi.fn(),
  insertChunks: vi.fn(),
  chunkText: vi.fn(),
  resolvePlatformEmbeddingProvider: vi.fn(),
  embed: vi.fn(),
}));

vi.mock("@/lib/agent/rag/repository", () => ({
  findDocumentById,
  listDocumentsByShop,
  deleteChunksForDocument,
  insertChunks,
}));
vi.mock("@/lib/agent/rag/chunking", () => ({ chunkText }));
vi.mock("@/lib/agent/rag/provider-config", () => ({ resolvePlatformEmbeddingProvider }));

import { indexDocument, reindexShop } from "@/lib/agent/rag/indexing";

const document = {
  id: 1,
  shop_id: 15,
  type: "faq" as const,
  title: "Livraison",
  content: "Nous livrons partout au Maroc sous 2 à 5 jours ouvrés.",
};

const credentials = { apiKey: "test-key", model: "text-embedding-004" };

beforeEach(() => {
  findDocumentById.mockReset().mockResolvedValue(document);
  listDocumentsByShop.mockReset();
  deleteChunksForDocument.mockReset().mockResolvedValue(undefined);
  insertChunks.mockReset().mockResolvedValue(undefined);
  chunkText.mockReset().mockReturnValue(["Nous livrons partout au Maroc.", "Le délai est de 2 à 5 jours ouvrés."]);
  embed.mockReset().mockImplementation(async (_creds: unknown, content: string) => ({
    embedding: content.length > 0 ? [0.1, 0.2, 0.3] : [],
    model: "text-embedding-004",
  }));
  resolvePlatformEmbeddingProvider.mockReset().mockReturnValue({ provider: { embed }, credentials });
});

describe("indexDocument", () => {
  it("throws when the document does not exist, without touching chunks or embeddings", async () => {
    findDocumentById.mockResolvedValue(null);

    await expect(indexDocument(999)).rejects.toThrow("Cannot index document 999: it does not exist.");
    expect(chunkText).not.toHaveBeenCalled();
    expect(deleteChunksForDocument).not.toHaveBeenCalled();
  });

  it("embeds every chunk, then deletes the old chunks, then inserts the new ones — in that order", async () => {
    const calls: string[] = [];
    deleteChunksForDocument.mockImplementation(async () => {
      calls.push("delete");
    });
    insertChunks.mockImplementation(async () => {
      calls.push("insert");
    });
    embed.mockImplementation(async () => {
      calls.push("embed");
      return { embedding: [0.1, 0.2], model: "text-embedding-004" };
    });

    await indexDocument(1);

    expect(calls).toEqual(["embed", "embed", "delete", "insert"]);
  });

  it("passes the resolved credentials to the provider for every chunk", async () => {
    await indexDocument(1);

    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed).toHaveBeenNthCalledWith(1, credentials, "Nous livrons partout au Maroc.");
    expect(embed).toHaveBeenNthCalledWith(2, credentials, "Le délai est de 2 à 5 jours ouvrés.");
  });

  it("inserts new chunks carrying the document's own id and shop_id", async () => {
    await indexDocument(1);

    expect(insertChunks).toHaveBeenCalledWith([
      { document_id: 1, shop_id: 15, content: "Nous livrons partout au Maroc.", embedding: [0.1, 0.2, 0.3] },
      { document_id: 1, shop_id: 15, content: "Le délai est de 2 à 5 jours ouvrés.", embedding: [0.1, 0.2, 0.3] },
    ]);
  });

  it("never deletes the existing chunks when an embedding call fails partway through", async () => {
    embed.mockResolvedValueOnce({ embedding: [0.1, 0.2, 0.3], model: "text-embedding-004" }).mockRejectedValueOnce(
      new Error("rate limit exceeded")
    );

    await expect(indexDocument(1)).rejects.toThrow("rate limit exceeded");

    expect(deleteChunksForDocument).not.toHaveBeenCalled();
    expect(insertChunks).not.toHaveBeenCalled();
  });

  it("clears stale chunks and never resolves an embedding provider for an empty document", async () => {
    chunkText.mockReturnValue([]);

    await indexDocument(1);

    expect(resolvePlatformEmbeddingProvider).not.toHaveBeenCalled();
    expect(deleteChunksForDocument).toHaveBeenCalledWith(1);
    expect(insertChunks).not.toHaveBeenCalled();
  });
});

describe("reindexShop", () => {
  it("returns a zeroed result when the shop has no documents", async () => {
    listDocumentsByShop.mockResolvedValue([]);

    await expect(reindexShop(15)).resolves.toEqual({ total: 0, succeeded: 0, failed: [] });
  });

  it("reindexes every document and reports full success", async () => {
    const doc1 = { ...document, id: 1 };
    const doc2 = { ...document, id: 2 };
    listDocumentsByShop.mockResolvedValue([doc1, doc2]);
    findDocumentById.mockImplementation(async (id: number) => [doc1, doc2].find((d) => d.id === id) ?? null);

    const result = await reindexShop(15);

    expect(result).toEqual({ total: 2, succeeded: 2, failed: [] });
  });

  it("isolates one document's failure from the rest, reporting it without stopping the batch", async () => {
    const doc1 = { ...document, id: 1 };
    const doc2 = { ...document, id: 2 };
    const doc3 = { ...document, id: 3 };
    listDocumentsByShop.mockResolvedValue([doc1, doc2, doc3]);
    findDocumentById.mockImplementation(async (id: number) => [doc1, doc2, doc3].find((d) => d.id === id) ?? null);

    let callCount = 0;
    embed.mockImplementation(async () => {
      callCount += 1;
      // Fail on doc2's first chunk (calls 3-4 belong to doc2, given 2 chunks per doc).
      if (callCount === 3) {
        throw new Error("upstream embedding API down");
      }
      return { embedding: [0.1, 0.2, 0.3], model: "text-embedding-004" };
    });

    const result = await reindexShop(15);

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toEqual([{ document_id: 2, error: "upstream embedding API down" }]);
  });
});
