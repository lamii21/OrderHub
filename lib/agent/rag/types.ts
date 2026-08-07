// The RAG domain's shared vocabulary — same role for this folder that
// lib/agent/types.ts plays for the conversation domain. V1 scope is
// deliberately limited to merchant-authored static knowledge (faq, policy,
// pdf, note) — matches agent_documents.type's own CHECK constraint exactly,
// no wider. Products are excluded on purpose: product data changes far
// more often than a FAQ answer, and lib/agent/tools/products already
// answers "do you have this" against live stock/price — a stale embedded
// snapshot of a price would be a regression, not an improvement. Extending
// this list to a "product" type is a deliberate, separate decision for a
// later phase, not an oversight here.
export const RAG_DOCUMENT_TYPES = ["faq", "policy", "pdf", "note"] as const;
export type RagDocumentType = (typeof RAG_DOCUMENT_TYPES)[number];

// Runtime counterpart to the type above — needed anywhere a document type
// arrives as a plain string from outside the type system (Étape 8.6's
// document management), same "a closed union needs a matching type guard
// at its actual input boundary" pattern as lib/validation.ts's
// isValidOrderStatus for ORDER_STATUSES.
export function isRagDocumentType(value: string): value is RagDocumentType {
  return (RAG_DOCUMENT_TYPES as readonly string[]).includes(value);
}

// What the retriever (lib/agent/rag/retriever.ts, a later Étape) hands back
// to the engine — never a raw agent_document_chunks row. No internal id
// (neither the chunk's nor the document's) is exposed, same "never a raw
// Supabase id reaches the model" convention Phase 6's business tools
// already established; document_type and title are what let the prompt
// attribute an answer ("according to our return policy") without needing
// an id for that.
export type RetrievedChunk = {
  document_type: RagDocumentType;
  title: string;
  content: string;
  score: number;
};
