import { describe, it, expect, vi, beforeEach } from "vitest";

const { createDocument, updateDocument, deleteDocument, indexDocument } = vi.hoisted(() => ({
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  indexDocument: vi.fn(),
}));

vi.mock("@/lib/agent/rag/repository", () => ({ createDocument, updateDocument, deleteDocument }));
vi.mock("@/lib/agent/rag/indexing", () => ({ indexDocument }));

import { createAndIndexDocument, updateAndReindexDocument, removeDocument } from "@/lib/agent/rag/documents";

const document = { id: 1, shop_id: 15, type: "faq" as const, title: "Livraison", content: "Nous livrons au Maroc." };

beforeEach(() => {
  createDocument.mockReset().mockResolvedValue(document);
  updateDocument.mockReset().mockResolvedValue(document);
  deleteDocument.mockReset().mockResolvedValue(true);
  indexDocument.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createAndIndexDocument", () => {
  it("creates the document and indexes it, reporting success", async () => {
    const input = { shop_id: 15, type: "faq" as const, title: "Livraison", content: "Nous livrons au Maroc." };

    const result = await createAndIndexDocument(input);

    expect(createDocument).toHaveBeenCalledWith(input);
    expect(indexDocument).toHaveBeenCalledWith(1);
    expect(result).toEqual({ document, indexed: true });
  });

  it("still returns the saved document when indexing fails afterward", async () => {
    indexDocument.mockRejectedValue(new Error("RAG_EMBEDDING_PROVIDER is not set"));

    const result = await createAndIndexDocument({
      shop_id: 15,
      type: "faq",
      title: "Livraison",
      content: "Nous livrons au Maroc.",
    });

    expect(result).toEqual({ document, indexed: false });
  });

  it("rejects an empty title without ever creating the document", async () => {
    await expect(
      createAndIndexDocument({ shop_id: 15, type: "faq", title: "   ", content: "Nous livrons au Maroc." })
    ).rejects.toThrow("Document title cannot be empty.");
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("rejects empty content without ever creating the document", async () => {
    await expect(
      createAndIndexDocument({ shop_id: 15, type: "faq", title: "Livraison", content: "   " })
    ).rejects.toThrow("Document content cannot be empty.");
    expect(createDocument).not.toHaveBeenCalled();
  });
});

describe("updateAndReindexDocument", () => {
  it("updates the document and reindexes it, reporting success", async () => {
    const result = await updateAndReindexDocument(1, 15, { content: "Nouveau contenu." });

    expect(updateDocument).toHaveBeenCalledWith(1, 15, { content: "Nouveau contenu." });
    expect(indexDocument).toHaveBeenCalledWith(1);
    expect(result).toEqual({ document, indexed: true });
  });

  it("returns null, never attempts to index, when the document doesn't exist or isn't owned by this shop", async () => {
    updateDocument.mockResolvedValue(null);

    const result = await updateAndReindexDocument(1, 999, { content: "x" });

    expect(result).toBeNull();
    expect(indexDocument).not.toHaveBeenCalled();
  });

  it("still returns the updated document when reindexing fails afterward", async () => {
    indexDocument.mockRejectedValue(new Error("provider down"));

    const result = await updateAndReindexDocument(1, 15, { content: "Nouveau contenu." });

    expect(result).toEqual({ document, indexed: false });
  });

  it("rejects an empty title patch without ever calling the repository", async () => {
    await expect(updateAndReindexDocument(1, 15, { title: "   " })).rejects.toThrow(
      "Document title cannot be empty."
    );
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("allows a patch that doesn't touch title/content at all", async () => {
    await expect(updateAndReindexDocument(1, 15, { type: "policy" })).resolves.toEqual({ document, indexed: true });
  });
});

describe("removeDocument", () => {
  it("delegates directly to the repository", async () => {
    await expect(removeDocument(1, 15)).resolves.toBe(true);
    expect(deleteDocument).toHaveBeenCalledWith(1, 15);
  });

  it("returns false as reported by the repository, without throwing", async () => {
    deleteDocument.mockResolvedValue(false);
    await expect(removeDocument(1, 999)).resolves.toBe(false);
  });
});
