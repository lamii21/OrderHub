import { supabase } from "@/lib/supabase";
import type { RagDocumentType } from "./types";

// Pure Supabase I/O over agent_documents/agent_document_chunks — no
// decisions here, same rule as every other repository.ts in this project.

export type AgentDocument = {
  id: number;
  shop_id: number;
  type: RagDocumentType;
  title: string;
  content: string;
};

const DOCUMENT_COLUMNS = "id, shop_id, type, title, content";

export async function findDocumentById(documentId: number): Promise<AgentDocument | null> {
  const { data, error } = await supabase
    .from("agent_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// Added for Étape 8.3's reindexShop() — a full re-embed of every one of a
// shop's documents, needed if the platform's embedding provider/model ever
// changes (see provider-config.ts). Not needed by anything before this.
export async function listDocumentsByShop(shopId: number): Promise<AgentDocument[]> {
  const { data, error } = await supabase.from("agent_documents").select(DOCUMENT_COLUMNS).eq("shop_id", shopId);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

// Étape 8.6 — minimal document management. shop_id is trusted here (a new
// row, nothing to check it against yet), unlike update/delete below.
export type NewDocumentInput = {
  shop_id: number;
  type: RagDocumentType;
  title: string;
  content: string;
};

export async function createDocument(input: NewDocumentInput): Promise<AgentDocument> {
  const { data, error } = await supabase.from("agent_documents").insert(input).select(DOCUMENT_COLUMNS).single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export type DocumentUpdateInput = Partial<{ type: RagDocumentType; title: string; content: string }>;

// Scoped by BOTH id and shop_id — unlike deleteChunksForDocument/
// insertChunks above, documentId here genuinely comes from a merchant's
// own action (a caller reading a form field), not an id this codebase
// already resolved for itself. A missing shop_id filter would let one
// shop's request edit another shop's document through the service-role
// client, which bypasses RLS entirely — this is the repository's own
// layer of that defense, independent of whatever ownership check a caller
// performs before reaching here. Returns null (not an error) when nothing
// matched: "not found" and "not yours" look identical on purpose, neither
// is information worth distinguishing for the caller.
export async function updateDocument(
  documentId: number,
  shopId: number,
  patch: DocumentUpdateInput
): Promise<AgentDocument | null> {
  const { data, error } = await supabase
    .from("agent_documents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("shop_id", shopId)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// Same double-scoping as updateDocument, same reasoning. No explicit chunk
// cleanup here: agent_document_chunks.document_id has "on delete cascade"
// (supabase/schema.sql) — deleting the document already deletes its
// chunks at the database level.
export async function deleteDocument(documentId: number, shopId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_documents")
    .delete()
    .eq("id", documentId)
    .eq("shop_id", shopId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data !== null;
}

// shop_id is carried on every chunk (denormalized from the parent
// document, exactly as supabase/schema.sql's own comment on
// agent_document_chunks already documents) so the future similarity search
// can filter by shop without a join on its hot path — this repository
// doesn't decide that, it just accepts the value the indexing service
// (Étape 8.3) already resolved from the document itself.
export type NewChunk = {
  document_id: number;
  shop_id: number;
  content: string;
  embedding: number[];
};

// Deletes by document_id alone — never customer- or model-supplied, always
// an id this codebase's own indexing service already resolved via
// findDocumentById, so there is no cross-shop leakage risk to guard
// against the way tools/orders's repository has to for an LLM-supplied
// order_id.
export async function deleteChunksForDocument(documentId: number): Promise<void> {
  const { error } = await supabase.from("agent_document_chunks").delete().eq("document_id", documentId);

  if (error) {
    throw new Error(error.message);
  }
}

// A plain no-op for an empty list rather than an empty insert() call — the
// latter is a degenerate request with nothing to write, not a real
// decision this function is making.
export async function insertChunks(chunks: NewChunk[]): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const { error } = await supabase.from("agent_document_chunks").insert(chunks);

  if (error) {
    throw new Error(error.message);
  }
}

// The k nearest neighbours by cosine distance, scoped to one shop — via
// the match_agent_document_chunks() RPC (supabase/schema.sql), since
// PostgREST has no fluent "order by embedding <=> query" method. No
// relevance threshold applied here: that's a policy decision
// (lib/agent/rag/retriever.ts's job), this function only translates one
// query.
export type ChunkSearchResult = {
  document_id: number;
  document_type: RagDocumentType;
  document_title: string;
  content: string;
  similarity: number;
};

export async function searchSimilarChunks(
  shopId: number,
  queryEmbedding: number[],
  limit: number
): Promise<ChunkSearchResult[]> {
  const { data, error } = await supabase.rpc("match_agent_document_chunks", {
    p_shop_id: shopId,
    p_query_embedding: queryEmbedding,
    p_match_count: limit,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ChunkSearchResult[];
}
