import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const { createAndIndexDocument, updateAndReindexDocument, removeDocument, indexDocument, reindexShop } = vi.hoisted(
  () => ({
    createAndIndexDocument: vi.fn(),
    updateAndReindexDocument: vi.fn(),
    removeDocument: vi.fn(),
    indexDocument: vi.fn(),
    reindexShop: vi.fn(),
  })
);
const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));
vi.mock("@/lib/agent/rag/documents", () => ({ createAndIndexDocument, updateAndReindexDocument, removeDocument }));
vi.mock("@/lib/agent/rag/indexing", () => ({ indexDocument, reindexShop }));

import {
  createDocumentAction,
  updateDocumentAction,
  deleteDocumentAction,
  reindexDocumentAction,
  reindexShopAction,
} from "@/app/shops/[id]/knowledge-base/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const savedDocument = { id: 42, shop_id: 1, type: "faq" as const, title: "Livraison", content: "x", last_indexed_at: null };

beforeEach(() => {
  createAndIndexDocument.mockReset();
  updateAndReindexDocument.mockReset();
  removeDocument.mockReset();
  indexDocument.mockReset();
  reindexShop.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createDocumentAction", () => {
  it("redirects to /shops without creating anything when shop_id is missing/invalid", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      createDocumentAction(formData({ shop_id: "not-a-number", type: "faq", title: "x", content: "y" }))
    ).rejects.toThrow("REDIRECT:/shops");
    expect(createAndIndexDocument).not.toHaveBeenCalled();
  });

  it("redirects to /shops when the shop isn't owned by the caller (RLS-scoped lookup returns nothing)", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(
      createDocumentAction(formData({ shop_id: "1", type: "faq", title: "x", content: "y" }))
    ).rejects.toThrow("REDIRECT:/shops");
    expect(createAndIndexDocument).not.toHaveBeenCalled();
  });

  it("redirects with an error for an invalid document type, without creating anything", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;

    await expect(
      createDocumentAction(formData({ shop_id: "1", type: "made-up", title: "x", content: "y" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/knowledge-base\?error=.*Invalid.*document.*type/);
    expect(createAndIndexDocument).not.toHaveBeenCalled();
  });

  it("creates the document and redirects with saved=1 when indexing succeeded", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    createAndIndexDocument.mockResolvedValue({ document: savedDocument, indexed: true });

    await expect(
      createDocumentAction(formData({ shop_id: "1", type: "faq", title: "Livraison", content: "Nous livrons." }))
    ).rejects.toThrow("REDIRECT:/shops/1/knowledge-base?saved=1");

    expect(createAndIndexDocument).toHaveBeenCalledWith({
      shop_id: 1,
      type: "faq",
      title: "Livraison",
      content: "Nous livrons.",
    });
  });

  it("redirects with saved=1&not_indexed=1 when the document saved but indexing did not succeed", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    createAndIndexDocument.mockResolvedValue({ document: savedDocument, indexed: false });

    await expect(
      createDocumentAction(formData({ shop_id: "1", type: "faq", title: "Livraison", content: "Nous livrons." }))
    ).rejects.toThrow("REDIRECT:/shops/1/knowledge-base?saved=1&not_indexed=1");
  });

  it("redirects with an error, never the raw one, when the service throws", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    createAndIndexDocument.mockRejectedValue(new Error("Document title cannot be empty."));

    await expect(
      createDocumentAction(formData({ shop_id: "1", type: "faq", title: "x", content: "y" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/knowledge-base\?error=.*Could.*not.*save/);
  });
});

describe("updateDocumentAction", () => {
  it("redirects to /shops when the shop isn't owned by the caller", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(
      updateDocumentAction(formData({ shop_id: "1", document_id: "42", title: "x", content: "y" }))
    ).rejects.toThrow("REDIRECT:/shops");
    expect(updateAndReindexDocument).not.toHaveBeenCalled();
  });

  it("redirects with an error for an invalid document_id", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;

    await expect(
      updateDocumentAction(formData({ shop_id: "1", document_id: "not-a-number", title: "x", content: "y" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/knowledge-base\?error=.*Invalid.*document/);
  });

  it("omits type from the patch entirely when left blank", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    updateAndReindexDocument.mockResolvedValue({ document: savedDocument, indexed: true });

    await expect(
      updateDocumentAction(formData({ shop_id: "1", document_id: "42", title: "Nouveau titre", content: "y" }))
    ).rejects.toThrow();

    expect(updateAndReindexDocument).toHaveBeenCalledWith(42, 1, { title: "Nouveau titre", content: "y" });
  });

  it("includes a valid type in the patch when provided", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    updateAndReindexDocument.mockResolvedValue({ document: savedDocument, indexed: true });

    await expect(
      updateDocumentAction(formData({ shop_id: "1", document_id: "42", type: "policy", title: "x", content: "y" }))
    ).rejects.toThrow();

    expect(updateAndReindexDocument).toHaveBeenCalledWith(42, 1, { type: "policy", title: "x", content: "y" });
  });

  it("redirects with an error for an invalid (non-empty) type, without calling the service", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;

    await expect(
      updateDocumentAction(formData({ shop_id: "1", document_id: "42", type: "made-up", title: "x", content: "y" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/knowledge-base\/42\/edit\?error=.*Invalid.*document.*type/);
    expect(updateAndReindexDocument).not.toHaveBeenCalled();
  });

  it("redirects to the edit page with saved=1 on success", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    updateAndReindexDocument.mockResolvedValue({ document: savedDocument, indexed: true });

    await expect(
      updateDocumentAction(formData({ shop_id: "1", document_id: "42", title: "x", content: "y" }))
    ).rejects.toThrow("REDIRECT:/shops/1/knowledge-base/42/edit?saved=1");
  });

  it("redirects to the list with 'Document not found' when the service returns null (not found or not owned)", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    updateAndReindexDocument.mockResolvedValue(null);

    await expect(
      updateDocumentAction(formData({ shop_id: "1", document_id: "42", title: "x", content: "y" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/knowledge-base\?error=.*Document.*not.*found/);
  });

  it("redirects with an error when the service throws", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    updateAndReindexDocument.mockRejectedValue(new Error("db down"));

    await expect(
      updateDocumentAction(formData({ shop_id: "1", document_id: "42", title: "x", content: "y" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/knowledge-base\/42\/edit\?error=.*Could.*not.*save/);
  });
});

describe("deleteDocumentAction", () => {
  it("redirects to /shops when the shop isn't owned by the caller", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(deleteDocumentAction(formData({ shop_id: "1", document_id: "42" }))).rejects.toThrow(
      "REDIRECT:/shops"
    );
    expect(removeDocument).not.toHaveBeenCalled();
  });

  it("deletes and redirects with deleted=1", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    removeDocument.mockResolvedValue(true);

    await expect(deleteDocumentAction(formData({ shop_id: "1", document_id: "42" }))).rejects.toThrow(
      "REDIRECT:/shops/1/knowledge-base?deleted=1"
    );
    expect(removeDocument).toHaveBeenCalledWith(42, 1);
  });

  it("still redirects with deleted=1 even when the document was already gone (idempotent)", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    removeDocument.mockResolvedValue(false);

    await expect(deleteDocumentAction(formData({ shop_id: "1", document_id: "42" }))).rejects.toThrow(
      "REDIRECT:/shops/1/knowledge-base?deleted=1"
    );
  });

  it("redirects with an error when the service throws", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    removeDocument.mockRejectedValue(new Error("db down"));

    await expect(deleteDocumentAction(formData({ shop_id: "1", document_id: "42" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/knowledge-base\?error=.*Could.*not.*delete/
    );
  });
});

describe("reindexDocumentAction", () => {
  it("redirects to /shops when the shop isn't owned by the caller", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(reindexDocumentAction(formData({ shop_id: "1", document_id: "42" }))).rejects.toThrow(
      "REDIRECT:/shops"
    );
    expect(indexDocument).not.toHaveBeenCalled();
  });

  it("redirects with 'Document not found' when the document doesn't belong to this shop, without ever indexing", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: { id: 1 }, error: null }, agent_documents: { data: null, error: null } },
    });
    holder.client = client;

    await expect(reindexDocumentAction(formData({ shop_id: "1", document_id: "42" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/knowledge-base\?error=.*Document.*not.*found/
    );
    expect(indexDocument).not.toHaveBeenCalled();
  });

  it("reindexes and redirects with reindexed=1 when the document belongs to this shop", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: { id: 1 }, error: null }, agent_documents: { data: { id: 42 }, error: null } },
    });
    holder.client = client;

    await expect(reindexDocumentAction(formData({ shop_id: "1", document_id: "42" }))).rejects.toThrow(
      "REDIRECT:/shops/1/knowledge-base/42/edit?reindexed=1"
    );
    expect(indexDocument).toHaveBeenCalledWith(42);
  });

  it("redirects with an error when indexing throws", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: { id: 1 }, error: null }, agent_documents: { data: { id: 42 }, error: null } },
    });
    holder.client = client;
    indexDocument.mockRejectedValue(new Error("RAG_EMBEDDING_PROVIDER is not set"));

    await expect(reindexDocumentAction(formData({ shop_id: "1", document_id: "42" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/knowledge-base\/42\/edit\?error=.*Could.*not.*reindex/
    );
  });
});

describe("reindexShopAction", () => {
  it("redirects to /shops when the shop isn't owned by the caller", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(reindexShopAction(formData({ shop_id: "1" }))).rejects.toThrow("REDIRECT:/shops");
    expect(reindexShop).not.toHaveBeenCalled();
  });

  it("reindexes the whole shop and redirects with the summary counts", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    reindexShop.mockResolvedValue({ total: 3, succeeded: 2, failed: [{ document_id: 7, error: "boom" }] });

    await expect(reindexShopAction(formData({ shop_id: "1" }))).rejects.toThrow(
      "REDIRECT:/shops/1/knowledge-base?reindexed=1&succeeded=2&total=3"
    );
    expect(reindexShop).toHaveBeenCalledWith(1);
  });

  it("redirects with an error when reindexShop throws", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: { id: 1 }, error: null } } });
    holder.client = client;
    reindexShop.mockRejectedValue(new Error("db down"));

    await expect(reindexShopAction(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/knowledge-base\?error=.*Could.*not.*reindex.*the.*knowledge.*base/
    );
  });
});
