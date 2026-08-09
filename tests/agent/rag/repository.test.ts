import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import {
  findDocumentById,
  listDocumentsByShop,
  stampDocumentIndexed,
  createDocument,
  updateDocument,
  deleteDocument,
  deleteChunksForDocument,
  insertChunks,
  searchSimilarChunks,
} from "@/lib/agent/rag/repository";

const documentRow = {
  id: 1,
  shop_id: 15,
  type: "faq",
  title: "Livraison",
  content: "Nous livrons partout au Maroc sous 2 à 5 jours ouvrés.",
  last_indexed_at: null,
};

describe("findDocumentById", () => {
  it("selects a document by id", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_documents: { data: documentRow, error: null } },
    });
    holder.client = client;

    const result = await findDocumentById(1);

    expect(builders.agent_documents[0].select).toHaveBeenCalledWith(
      "id, shop_id, type, title, content, last_indexed_at"
    );
    expect(builders.agent_documents[0].eq).toHaveBeenCalledWith("id", 1);
    expect(result).toEqual(documentRow);
  });

  it("returns null when no document matches", async () => {
    const { client } = createMockSupabase({ responses: { agent_documents: { data: null, error: null } } });
    holder.client = client;

    await expect(findDocumentById(999)).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_documents: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(findDocumentById(1)).rejects.toThrow("db down");
  });
});

describe("listDocumentsByShop", () => {
  it("scopes the query by shop_id", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_documents: { data: [documentRow], error: null } },
    });
    holder.client = client;

    const result = await listDocumentsByShop(15);

    expect(builders.agent_documents[0].select).toHaveBeenCalledWith(
      "id, shop_id, type, title, content, last_indexed_at"
    );
    expect(builders.agent_documents[0].eq).toHaveBeenCalledWith("shop_id", 15);
    expect(result).toEqual([documentRow]);
  });

  it("returns an empty array, not null, when the shop has no documents", async () => {
    const { client } = createMockSupabase({ responses: { agent_documents: { data: null, error: null } } });
    holder.client = client;

    await expect(listDocumentsByShop(15)).resolves.toEqual([]);
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_documents: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(listDocumentsByShop(15)).rejects.toThrow("db down");
  });
});

describe("stampDocumentIndexed", () => {
  it("updates last_indexed_at for the given document id alone, no shop_id scope", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_documents: { data: null, error: null } },
    });
    holder.client = client;

    await stampDocumentIndexed(1);

    expect(builders.agent_documents[0].update).toHaveBeenCalledWith({
      last_indexed_at: expect.any(String),
    });
    expect(builders.agent_documents[0].eq).toHaveBeenCalledWith("id", 1);
    expect(builders.agent_documents[0].eq).toHaveBeenCalledTimes(1);
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_documents: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(stampDocumentIndexed(1)).rejects.toThrow("db down");
  });
});

describe("createDocument", () => {
  it("inserts the given fields and returns the mapped document", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_documents: { data: documentRow, error: null } },
    });
    holder.client = client;

    const input = { shop_id: 15, type: "faq" as const, title: "Livraison", content: "Nous livrons au Maroc." };
    const result = await createDocument(input);

    expect(builders.agent_documents[0].insert).toHaveBeenCalledWith(input);
    expect(result).toEqual(documentRow);
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_documents: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(
      createDocument({ shop_id: 15, type: "faq", title: "Livraison", content: "Nous livrons au Maroc." })
    ).rejects.toThrow("db down");
  });
});

describe("updateDocument", () => {
  it("scopes the update by both id and shop_id", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_documents: { data: { ...documentRow, title: "Livraison (mise à jour)" }, error: null } },
    });
    holder.client = client;

    const result = await updateDocument(1, 15, { title: "Livraison (mise à jour)" });

    expect(builders.agent_documents[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Livraison (mise à jour)" })
    );
    expect(builders.agent_documents[0].eq).toHaveBeenNthCalledWith(1, "id", 1);
    expect(builders.agent_documents[0].eq).toHaveBeenNthCalledWith(2, "shop_id", 15);
    expect(result?.title).toBe("Livraison (mise à jour)");
  });

  it("returns null when the document doesn't exist or doesn't belong to this shop", async () => {
    const { client } = createMockSupabase({ responses: { agent_documents: { data: null, error: null } } });
    holder.client = client;

    await expect(updateDocument(1, 999, { title: "x" })).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_documents: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(updateDocument(1, 15, { title: "x" })).rejects.toThrow("db down");
  });
});

describe("deleteDocument", () => {
  it("scopes the delete by both id and shop_id, returning true when a row was removed", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_documents: { data: { id: 1 }, error: null } },
    });
    holder.client = client;

    const result = await deleteDocument(1, 15);

    expect(builders.agent_documents[0].eq).toHaveBeenNthCalledWith(1, "id", 1);
    expect(builders.agent_documents[0].eq).toHaveBeenNthCalledWith(2, "shop_id", 15);
    expect(result).toBe(true);
  });

  it("returns false when the document doesn't exist or doesn't belong to this shop", async () => {
    const { client } = createMockSupabase({ responses: { agent_documents: { data: null, error: null } } });
    holder.client = client;

    await expect(deleteDocument(1, 999)).resolves.toBe(false);
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_documents: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(deleteDocument(1, 15)).rejects.toThrow("db down");
  });
});

describe("deleteChunksForDocument", () => {
  it("deletes every chunk scoped to the given document_id", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_document_chunks: { data: null, error: null } },
    });
    holder.client = client;

    await deleteChunksForDocument(1);

    expect(builders.agent_document_chunks[0].delete).toHaveBeenCalled();
    expect(builders.agent_document_chunks[0].eq).toHaveBeenCalledWith("document_id", 1);
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_document_chunks: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(deleteChunksForDocument(1)).rejects.toThrow("db down");
  });
});

describe("insertChunks", () => {
  const chunks = [
    { document_id: 1, shop_id: 15, content: "Nous livrons partout au Maroc.", embedding: [0.1, 0.2, 0.3] },
    { document_id: 1, shop_id: 15, content: "Le délai est de 2 à 5 jours ouvrés.", embedding: [0.4, 0.5, 0.6] },
  ];

  it("inserts every given chunk in one call", async () => {
    const { client, builders } = createMockSupabase({
      responses: { agent_document_chunks: { data: null, error: null } },
    });
    holder.client = client;

    await insertChunks(chunks);

    expect(builders.agent_document_chunks[0].insert).toHaveBeenCalledWith(chunks);
  });

  it("does nothing, never touches Supabase, for an empty list", async () => {
    const { client, builders } = createMockSupabase({});
    holder.client = client;

    await insertChunks([]);

    expect(builders.agent_document_chunks).toBeUndefined();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { agent_document_chunks: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(insertChunks(chunks)).rejects.toThrow("db down");
  });
});

describe("searchSimilarChunks", () => {
  const searchResult = {
    document_id: 1,
    document_type: "faq",
    document_title: "Livraison",
    content: "Nous livrons partout au Maroc.",
    similarity: 0.91,
  };

  it("calls the match_agent_document_chunks RPC with the shop, embedding, and limit", async () => {
    const { client } = createMockSupabase({ rpc: { match_agent_document_chunks: { data: [searchResult], error: null } } });
    holder.client = client;

    const result = await searchSimilarChunks(15, [0.1, 0.2, 0.3], 5);

    expect(client.rpc).toHaveBeenCalledWith("match_agent_document_chunks", {
      p_shop_id: 15,
      p_query_embedding: [0.1, 0.2, 0.3],
      p_match_count: 5,
    });
    expect(result).toEqual([searchResult]);
  });

  it("returns an empty array, not null, when nothing matches", async () => {
    const { client } = createMockSupabase({ rpc: { match_agent_document_chunks: { data: null, error: null } } });
    holder.client = client;

    await expect(searchSimilarChunks(15, [0.1, 0.2, 0.3], 5)).resolves.toEqual([]);
  });

  it("throws on an RPC error", async () => {
    const { client } = createMockSupabase({
      rpc: { match_agent_document_chunks: { data: null, error: { message: "function does not exist" } } },
    });
    holder.client = client;

    await expect(searchSimilarChunks(15, [0.1, 0.2, 0.3], 5)).rejects.toThrow("function does not exist");
  });
});
