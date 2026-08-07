import {
  createDocument,
  updateDocument,
  deleteDocument,
  type AgentDocument,
  type NewDocumentInput,
  type DocumentUpdateInput,
} from "./repository";
import { indexDocument } from "./indexing";

// Business rules for the document lifecycle — repository.ts stays pure
// I/O (Étape 8.1's own rule), this is where "creating or editing a
// document also (best-effort) indexes it" is decided, same
// repository -> service split as every other domain in this project.

function assertValidDocumentContent(input: { title?: string; content?: string }): void {
  if (input.title !== undefined && input.title.trim() === "") {
    throw new Error("Document title cannot be empty.");
  }

  if (input.content !== undefined && input.content.trim() === "") {
    throw new Error("Document content cannot be empty.");
  }
}

export type SaveDocumentResult = {
  document: AgentDocument;
  // Whether indexing succeeded right after the save — best-effort, never
  // blocks the save itself (same "the primary action always succeeds, a
  // secondary one degrades" posture as provisionShopSpreadsheetOrSkip). A
  // caller seeing indexed: false knows the document was saved but isn't
  // searchable by the agent yet — e.g. the platform's embedding provider
  // isn't configured (Étape 8.7), or a transient provider failure.
  indexed: boolean;
};

export async function createAndIndexDocument(input: NewDocumentInput): Promise<SaveDocumentResult> {
  assertValidDocumentContent(input);

  const document = await createDocument(input);
  const indexed = await tryIndex(document.id);

  return { document, indexed };
}

// Returns null (not an error) when the document doesn't exist or doesn't
// belong to this shop — repository.ts's updateDocument already collapses
// both into the same outcome, and this function has no more information
// to add on top of that.
export async function updateAndReindexDocument(
  documentId: number,
  shopId: number,
  patch: DocumentUpdateInput
): Promise<SaveDocumentResult | null> {
  assertValidDocumentContent(patch);

  const document = await updateDocument(documentId, shopId, patch);

  if (!document) {
    return null;
  }

  const indexed = await tryIndex(document.id);

  return { document, indexed };
}

// No explicit chunk cleanup call — repository.ts's own deleteDocument
// comment already explains why (on delete cascade). Returns false, same
// "not found and not yours look the same" posture, for a document that
// doesn't exist or doesn't belong to this shop.
export async function removeDocument(documentId: number, shopId: number): Promise<boolean> {
  return deleteDocument(documentId, shopId);
}

async function tryIndex(documentId: number): Promise<boolean> {
  try {
    await indexDocument(documentId);
    return true;
  } catch (err) {
    console.error(`documents: failed to index document ${documentId} after save:`, err);
    return false;
  }
}
