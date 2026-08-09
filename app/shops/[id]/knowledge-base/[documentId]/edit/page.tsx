import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { SubmitButton } from "@/components/submit-button";
import { formatRelativeTime } from "@/lib/utils";
import { RAG_DOCUMENT_TYPES, RAG_DOCUMENT_TYPE_LABELS } from "@/lib/agent/rag/types";
import { updateDocumentAction, deleteDocumentAction, reindexDocumentAction } from "../../actions";

export const revalidate = 0;

type SearchParams = {
  saved?: string;
  not_indexed?: string;
  reindexed?: string;
  error?: string;
};

export default async function EditKnowledgeBaseDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; documentId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id, documentId } = await params;
  const sp = await searchParams;

  // RLS's "Users can view documents for their own shops" policy is what
  // actually stops this from returning a document belonging to a shop the
  // caller doesn't own. Scoping by both id and shop_id here (rather than
  // id alone) means a document that exists but belongs to a different shop
  // 404s exactly like one that doesn't exist at all — same "not found and
  // not yours look identical" posture lib/agent/rag/repository.ts already
  // documents, now also at the page level.
  //
  // This is a display-only convenience, not the real defense: it only
  // decides what this page renders. The actions this page's forms submit
  // to (updateDocumentAction, deleteDocumentAction, reindexDocumentAction)
  // each re-verify ownership themselves before touching anything — a
  // forged POST straight to one of those actions must be rejected on its
  // own, regardless of what this page ever showed.
  const supabase = await createSupabaseServerClient();
  const { data: document, error } = await supabase
    .from("agent_documents")
    .select("id, shop_id, type, title, content, last_indexed_at")
    .eq("id", documentId)
    .eq("shop_id", id)
    .maybeSingle();

  if (error) {
    console.error("Knowledge base edit: failed to load document:", error);
  }

  if (!document) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Edit Document</h1>
        <Link href={`/shops/${id}/knowledge-base`} className="text-sm text-blue-600 hover:underline">
          ← Back to Knowledge Base
        </Link>
      </div>

      {sp.saved !== undefined && sp.not_indexed === undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Document saved.
        </p>
      )}
      {sp.saved !== undefined && sp.not_indexed !== undefined && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Document saved, but indexing failed — it won&apos;t show up in agent answers yet. Try
          reindexing it below.
        </p>
      )}
      {sp.reindexed !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Document reindexed.
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Document</h2>
        <form action={updateDocumentAction} className="space-y-4">
          <input type="hidden" name="shop_id" value={id} />
          <input type="hidden" name="document_id" value={document.id} />

          <div>
            <label htmlFor="type" className="mb-1 block text-sm font-medium text-gray-700">
              Type
            </label>
            <select
              id="type"
              name="type"
              required
              defaultValue={document.type}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {RAG_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {RAG_DOCUMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              defaultValue={document.title}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="content" className="mb-1 block text-sm font-medium text-gray-700">
              Content
            </label>
            <textarea
              id="content"
              name="content"
              required
              rows={10}
              defaultValue={document.content}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <SubmitButton pendingLabel="Saving…">Save Changes</SubmitButton>
        </form>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold">Indexing</h2>
        <p className="mb-4 text-sm text-gray-500">
          {document.last_indexed_at
            ? `Last indexed ${formatRelativeTime(new Date(document.last_indexed_at))}.`
            : "Not indexed yet — this document won't show up in agent answers until it is."}
        </p>
        <ConfirmActionForm
          shopId={Number(id)}
          action={reindexDocumentAction}
          buttonLabel="Reindex"
          pendingLabel="Reindexing…"
          confirmMessage="Reindex this document now? Useful after fixing a failed indexing attempt or if the platform's embedding model changed."
        >
          <input type="hidden" name="document_id" value={document.id} />
        </ConfirmActionForm>
      </div>

      <div className="rounded-lg border border-red-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-red-700">Danger Zone</h2>
        <p className="mb-4 text-sm text-gray-500">
          Permanently delete this document and its indexed content. This cannot be undone.
        </p>
        <ConfirmActionForm
          shopId={Number(id)}
          action={deleteDocumentAction}
          buttonLabel="Delete Document"
          pendingLabel="Deleting…"
          confirmMessage={`Delete "${document.title}"? This cannot be undone.`}
        >
          <input type="hidden" name="document_id" value={document.id} />
        </ConfirmActionForm>
      </div>
    </main>
  );
}
