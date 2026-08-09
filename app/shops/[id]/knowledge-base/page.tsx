import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";
import { RAG_DOCUMENT_TYPE_LABELS, type RagDocumentType } from "@/lib/agent/rag/types";
import { reindexShopAction } from "./actions";

export const revalidate = 0;

type SearchParams = {
  saved?: string;
  not_indexed?: string;
  deleted?: string;
  reindexed?: string;
  succeeded?: string;
  total?: string;
  error?: string;
};

type DocumentRow = {
  id: number;
  type: RagDocumentType;
  title: string;
  last_indexed_at: string | null;
};

export default async function KnowledgeBaseListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // RLS's "Users can view their own shops" policy is what actually stops
  // this from returning another user's shop or documents for a guessed id
  // — same pattern as app/shops/[id]/integrations/page.tsx, kept here
  // deliberately rather than routing this read through
  // lib/agent/rag/repository.ts's listDocumentsByShop(), which uses the
  // service-role client and has no ownership check of its own.
  const supabase = await createSupabaseServerClient();
  const [{ data: shop, error: shopError }, { data: documents, error: docsError }] = await Promise.all([
    supabase.from("shops").select("id, name").eq("id", id).single(),
    supabase
      .from("agent_documents")
      .select("id, type, title, last_indexed_at")
      .eq("shop_id", id)
      .order("title"),
  ]);

  if (shopError || !shop) {
    notFound();
  }

  if (docsError) {
    console.error("Knowledge base list: failed to load documents:", docsError);
  }

  const rows = (documents ?? []) as DocumentRow[];

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{shop.name} — Knowledge Base</h1>
          <Link href={`/shops/${shop.id}`} className="text-sm text-blue-600 hover:underline">
            ← Back to {shop.name}
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {rows.length > 0 && (
            <ConfirmActionForm
              shopId={shop.id}
              action={reindexShopAction}
              buttonLabel="Reindex All"
              pendingLabel="Reindexing…"
              confirmMessage="Reindex every document in this knowledge base? This re-embeds each document with the platform's current embedding model — useful after the model changes, but not needed for everyday edits."
            />
          )}
          <Link
            href={`/shops/${shop.id}/knowledge-base/new`}
            className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Document
          </Link>
        </div>
      </div>

      {sp.saved !== undefined && sp.not_indexed === undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Document saved.
        </p>
      )}
      {sp.saved !== undefined && sp.not_indexed !== undefined && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Document saved, but indexing failed — it won&apos;t show up in agent answers yet. Try
          reindexing it from its edit page.
        </p>
      )}
      {sp.deleted !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Document deleted.
        </p>
      )}
      {sp.reindexed !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Reindexed {sp.succeeded ?? "0"} of {sp.total ?? "0"} documents
          {sp.succeeded !== sp.total ? " — check individual documents for failures." : "."}
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Indexing Status</TableHead>
              <TableHead>Last Indexed</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((document) => (
              <TableRow key={document.id}>
                <TableCell>
                  <Link
                    href={`/shops/${shop.id}/knowledge-base/${document.id}/edit`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {document.title}
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{RAG_DOCUMENT_TYPE_LABELS[document.type]}</TableCell>
                <TableCell>
                  <span
                    className={
                      document.last_indexed_at
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"
                        : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600"
                    }
                  >
                    {document.last_indexed_at ? "Indexed" : "Not indexed"}
                  </span>
                </TableCell>
                <TableCell>
                  {document.last_indexed_at ? formatRelativeTime(new Date(document.last_indexed_at)) : "Never"}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/shops/${shop.id}/knowledge-base/${document.id}/edit`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Edit
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <p className="p-6 text-center text-gray-500">
            No documents yet. Add an FAQ, policy, or note so the AI agent can answer questions from
            it.
          </p>
        )}
      </div>
    </main>
  );
}
