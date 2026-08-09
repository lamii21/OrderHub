import Link from "next/link";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { RAG_DOCUMENT_TYPES, RAG_DOCUMENT_TYPE_LABELS } from "@/lib/agent/rag/types";
import { createDocumentAction } from "../actions";

// No shop lookup here, same idiom as workflows/new/page.tsx — ownership is
// verified by createDocumentAction itself (verifyShopOwnership) before it
// ever touches the database, so a second check here would be redundant.
// The "required" attributes below are UX only: createDocumentAction re-runs
// its own validation (isRagDocumentType, non-empty title/content) and stays
// the actual source of truth, since a form can always be submitted with
// dev tools or a direct POST bypassing HTML validation entirely.
export default async function NewKnowledgeBaseDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">New Document</h1>
      <Link href={`/shops/${id}/knowledge-base`} className="text-sm text-blue-600 hover:underline">
        ← Back to Knowledge Base
      </Link>

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      )}

      <form action={createDocumentAction} className="mt-4 space-y-4 rounded-lg border bg-white p-6">
        <input type="hidden" name="shop_id" value={id} />

        <div>
          <label htmlFor="type" className="mb-1 block text-sm font-medium text-gray-700">
            Type
          </label>
          <select
            id="type"
            name="type"
            required
            defaultValue={RAG_DOCUMENT_TYPES[0]}
            className="w-full rounded-md border px-3 py-2 text-sm"
          >
            {RAG_DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {RAG_DOCUMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <FormField id="title" name="title" label="Title" required />

        <div>
          <label htmlFor="content" className="mb-1 block text-sm font-medium text-gray-700">
            Content
          </label>
          <textarea
            id="content"
            name="content"
            required
            rows={10}
            placeholder="What the AI agent should know — the actual FAQ answer, policy text, or note."
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <SubmitButton pendingLabel="Creating…">Create Document</SubmitButton>
      </form>
    </main>
  );
}
