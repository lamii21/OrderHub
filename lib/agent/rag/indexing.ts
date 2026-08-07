import { findDocumentById, listDocumentsByShop, deleteChunksForDocument, insertChunks, type NewChunk } from "./repository";
import { chunkText } from "./chunking";
import { resolvePlatformEmbeddingProvider } from "./provider-config";

// The exact chain requested: findDocumentById -> chunkText -> embed each
// chunk -> deleteChunksForDocument -> insertChunks. The ordering is the
// whole point: every embedding is computed and held in memory BEFORE any
// existing chunk is deleted. If the embedding provider fails partway
// through (a rate limit, a network error, an auth failure), this function
// throws before touching deleteChunksForDocument at all — a document's
// existing index survives a failed reindex attempt untouched, rather than
// being left empty.
export async function indexDocument(documentId: number): Promise<void> {
  const document = await findDocumentById(documentId);

  if (!document) {
    throw new Error(`Cannot index document ${documentId}: it does not exist.`);
  }

  const pieces = chunkText(document.content);

  if (pieces.length === 0) {
    // An empty/whitespace-only document has nothing to embed — but any
    // chunks left over from a previous, non-empty version of this same
    // document would now be stale (answering from content that no longer
    // exists), so they still need clearing.
    await deleteChunksForDocument(documentId);
    return;
  }

  const { provider, credentials } = resolvePlatformEmbeddingProvider();

  // Sequential, not parallel — indexing is not a hot path (triggered by a
  // document being created or edited, not by a customer-facing request),
  // and a handful of chunks per document doesn't warrant the added
  // complexity of lib/concurrency.ts's bounded fan-out helper. Revisit if
  // real documents turn out to chunk into enough pieces for this to matter.
  const newChunks: NewChunk[] = [];
  for (const content of pieces) {
    const { embedding } = await provider.embed(credentials, content);
    newChunks.push({ document_id: document.id, shop_id: document.shop_id, content, embedding });
  }

  // Only now — every embedding already computed and held above — are the
  // old chunks removed and the new ones written.
  await deleteChunksForDocument(documentId);
  await insertChunks(newChunks);
}

export type ReindexShopResult = {
  total: number;
  succeeded: number;
  failed: { document_id: number; error: string }[];
};

// A full re-embed of every document a shop owns — the only recovery path
// when the platform's embedding provider/model changes (provider-config.ts),
// since every existing embedding in agent_document_chunks was computed by
// the old model and is meaningless compared against a query embedded by a
// new one. Best-effort per document, not all-or-nothing: one document's
// embedding failure (a malformed document, a transient provider error)
// must not stop every other document in the shop from being reindexed —
// same "isolate one failure from the rest" posture already used by
// lib/agent/events.ts's emitAgentEvent(). The caller gets back exactly
// which documents failed and why, rather than a single opaque success/fail.
export async function reindexShop(shopId: number): Promise<ReindexShopResult> {
  const documents = await listDocumentsByShop(shopId);
  const failed: { document_id: number; error: string }[] = [];
  let succeeded = 0;

  for (const document of documents) {
    try {
      await indexDocument(document.id);
      succeeded += 1;
    } catch (err) {
      failed.push({ document_id: document.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { total: documents.length, succeeded, failed };
}
