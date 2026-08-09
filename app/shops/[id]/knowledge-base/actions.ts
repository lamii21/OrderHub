"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { parsePositiveInt } from "@/lib/validation";
import { isRagDocumentType, type RagDocumentType } from "@/lib/agent/rag/types";
import { createAndIndexDocument, updateAndReindexDocument, removeDocument, type SaveDocumentResult } from "@/lib/agent/rag/documents";
import { indexDocument, reindexShop, type ReindexShopResult } from "@/lib/agent/rag/indexing";

// Ownership is verified the same way regenerateSpreadsheet()
// (app/shops/[id]/settings/actions.ts) already does: a read through the
// RLS-scoped client, which returns nothing for a shop_id that isn't the
// caller's own. Only then do lib/agent/rag/documents.ts and
// lib/agent/rag/indexing.ts run, via the service-role client —
// repository.ts's own double (id, shop_id) scoping on update/delete stays
// a second, independent layer on top of this, not a replacement for it.
async function verifyShopOwnership(shopId: number): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("shops").select("id").eq("id", shopId).maybeSingle();
  return data !== null;
}

// indexDocument()/reindexShop() (lib/agent/rag/indexing.ts) operate purely
// on a document_id, with no shop scoping of their own — unlike
// updateDocument/deleteDocument, whose double (id, shop_id) scope in
// repository.ts already makes verifyShopOwnership above sufficient. A
// reindex action needs this extra check itself, load-bearing here, not
// just a UX nicety: without it, a caller who owns *some* shop could
// trigger reindexing of a document belonging to a shop they don't own.
async function verifyDocumentOwnership(documentId: number, shopId: number): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("agent_documents")
    .select("id")
    .eq("id", documentId)
    .eq("shop_id", shopId)
    .maybeSingle();
  return data !== null;
}

function knowledgeBaseUrl(shopId: string, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `/shops/${shopId}/knowledge-base${query}`;
}

function editUrl(shopId: string, documentId: number, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `/shops/${shopId}/knowledge-base/${documentId}/edit${query}`;
}

// A saved document that failed to index isn't an error from the caller's
// point of view (createAndIndexDocument/updateAndReindexDocument already
// treat indexing as best-effort) — surfaced as a mild "saved, but not yet
// searchable" query param instead of the sharper `error` one.
function savedParams(indexed: boolean): Record<string, string> {
  return indexed ? { saved: "1" } : { saved: "1", not_indexed: "1" };
}

export async function createDocumentAction(formData: FormData) {
  const shopIdParam = String(formData.get("shop_id") ?? "");
  const shopId = parsePositiveInt(formData.get("shop_id"));

  if (shopId === null || !(await verifyShopOwnership(shopId))) {
    redirect("/shops");
  }

  const type = String(formData.get("type") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!isRagDocumentType(type)) {
    redirect(knowledgeBaseUrl(shopIdParam, { error: "Invalid document type." }));
  }

  // No redirect() call lives inside this try — Next's redirect() throws by
  // design, and a catch here would otherwise swallow a legitimate redirect
  // from deeper in the call and misreport it as "could not save".
  let result: SaveDocumentResult;

  try {
    result = await createAndIndexDocument({ shop_id: shopId, type, title, content });
  } catch (err) {
    console.error("createDocumentAction failed:", err);
    redirect(knowledgeBaseUrl(shopIdParam, { error: "Could not save the document." }));
  }

  redirect(knowledgeBaseUrl(shopIdParam, savedParams(result.indexed)));
}

export async function updateDocumentAction(formData: FormData) {
  const shopIdParam = String(formData.get("shop_id") ?? "");
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const documentId = parsePositiveInt(formData.get("document_id"));

  if (shopId === null || !(await verifyShopOwnership(shopId))) {
    redirect("/shops");
  }

  if (documentId === null) {
    redirect(knowledgeBaseUrl(shopIdParam, { error: "Invalid document." }));
  }

  const typeRaw = String(formData.get("type") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (typeRaw !== "" && !isRagDocumentType(typeRaw)) {
    redirect(editUrl(shopIdParam, documentId, { error: "Invalid document type." }));
  }

  const patch: { type?: RagDocumentType; title: string; content: string } = { title, content };
  if (typeRaw !== "" && isRagDocumentType(typeRaw)) {
    patch.type = typeRaw;
  }

  let result: SaveDocumentResult | null;

  try {
    result = await updateAndReindexDocument(documentId, shopId, patch);
  } catch (err) {
    console.error("updateDocumentAction failed:", err);
    redirect(editUrl(shopIdParam, documentId, { error: "Could not save the document." }));
  }

  if (!result) {
    redirect(knowledgeBaseUrl(shopIdParam, { error: "Document not found." }));
  }

  redirect(editUrl(shopIdParam, documentId, savedParams(result.indexed)));
}

export async function deleteDocumentAction(formData: FormData) {
  const shopIdParam = String(formData.get("shop_id") ?? "");
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const documentId = parsePositiveInt(formData.get("document_id"));

  if (shopId === null || !(await verifyShopOwnership(shopId))) {
    redirect("/shops");
  }

  if (documentId === null) {
    redirect(knowledgeBaseUrl(shopIdParam, { error: "Invalid document." }));
  }

  try {
    await removeDocument(documentId, shopId);
  } catch (err) {
    console.error("deleteDocumentAction failed:", err);
    redirect(knowledgeBaseUrl(shopIdParam, { error: "Could not delete the document." }));
  }

  // Idempotent from the merchant's point of view — a document already
  // gone (removeDocument's own false) reads the same as one just deleted,
  // same "not found and not yours look the same" posture repository.ts
  // already documents.
  redirect(knowledgeBaseUrl(shopIdParam, { deleted: "1" }));
}

export async function reindexDocumentAction(formData: FormData) {
  const shopIdParam = String(formData.get("shop_id") ?? "");
  const shopId = parsePositiveInt(formData.get("shop_id"));
  const documentId = parsePositiveInt(formData.get("document_id"));

  if (shopId === null || !(await verifyShopOwnership(shopId))) {
    redirect("/shops");
  }

  if (documentId === null || !(await verifyDocumentOwnership(documentId, shopId))) {
    redirect(knowledgeBaseUrl(shopIdParam, { error: "Document not found." }));
  }

  try {
    await indexDocument(documentId);
  } catch (err) {
    console.error("reindexDocumentAction failed:", err);
    redirect(editUrl(shopIdParam, documentId, { error: "Could not reindex the document." }));
  }

  redirect(editUrl(shopIdParam, documentId, { reindexed: "1" }));
}

export async function reindexShopAction(formData: FormData) {
  const shopIdParam = String(formData.get("shop_id") ?? "");
  const shopId = parsePositiveInt(formData.get("shop_id"));

  if (shopId === null || !(await verifyShopOwnership(shopId))) {
    redirect("/shops");
  }

  let result: ReindexShopResult;

  try {
    result = await reindexShop(shopId);
  } catch (err) {
    console.error("reindexShopAction failed:", err);
    redirect(knowledgeBaseUrl(shopIdParam, { error: "Could not reindex the knowledge base." }));
  }

  redirect(
    knowledgeBaseUrl(shopIdParam, {
      reindexed: "1",
      succeeded: String(result.succeeded),
      total: String(result.total),
    })
  );
}
