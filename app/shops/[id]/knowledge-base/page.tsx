import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { ICONS } from "@/components/icons";
import { formatRelativeTime, safeDecodeURIComponent } from "@/lib/utils";
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
  const indexedCount = rows.filter((r) => r.last_indexed_at).length;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Knowledge Base</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <Link href={`/shops/${shop.id}`} className="text-neutral-500 hover:text-neutral-700">
              ← Back to {shop.name}
            </Link>
            <Link href={`/shops/${shop.id}/agent`} className="font-medium text-brand-600 hover:text-brand-700">
              AI Agent settings →
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            <Icon path={ICONS.document} className="h-4 w-4" />
            New Document
          </Link>
        </div>
      </div>

      {/* "Document → indexation → disponible pour l'Agent" made explicit,
          rather than left implicit in the table's own "Indexing Status"
          column alone. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs text-neutral-500 shadow-sm">
        <span className="font-medium text-neutral-700">How it works:</span>
        <span>Document written</span>
        <Icon path={ICONS.chevronDown} className="h-3 w-3 -rotate-90" />
        <span>indexed (embedded)</span>
        <Icon path={ICONS.chevronDown} className="h-3 w-3 -rotate-90" />
        <span>available to the Agent&apos;s RAG retrieval</span>
        <span className="ml-auto font-medium text-neutral-700">
          {indexedCount} / {rows.length} indexed
        </span>
      </div>

      {sp.saved !== undefined && sp.not_indexed === undefined && (
        <p className="rounded-md border border-success-100 bg-success-50 p-3 text-sm text-success-700">
          Document saved.
        </p>
      )}
      {sp.saved !== undefined && sp.not_indexed !== undefined && (
        <p className="rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-700">
          Document saved, but indexing failed — it won&apos;t show up in agent answers yet. Try
          reindexing it from its edit page.
        </p>
      )}
      {sp.deleted !== undefined && (
        <p className="rounded-md border border-success-100 bg-success-50 p-3 text-sm text-success-700">
          Document deleted.
        </p>
      )}
      {sp.reindexed !== undefined && (
        <p className="rounded-md border border-success-100 bg-success-50 p-3 text-sm text-success-700">
          Reindexed {sp.succeeded ?? "0"} of {sp.total ?? "0"} documents
          {sp.succeeded !== sp.total ? " — check individual documents for failures." : "."}
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-danger-100 bg-danger-50 p-3 text-sm text-danger-700">
          {safeDecodeURIComponent(sp.error)}
        </p>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
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
                    className="font-medium text-brand-600 hover:text-brand-700"
                  >
                    {document.title}
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{RAG_DOCUMENT_TYPE_LABELS[document.type]}</TableCell>
                <TableCell>
                  <Badge tone={document.last_indexed_at ? "success" : "neutral"}>
                    {document.last_indexed_at ? "Indexed" : "Not indexed"}
                  </Badge>
                </TableCell>
                <TableCell className="text-neutral-500">
                  {document.last_indexed_at ? formatRelativeTime(new Date(document.last_indexed_at)) : "Never"}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/shops/${shop.id}/knowledge-base/${document.id}/edit`}
                    className="text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    Edit
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Icon path={ICONS.book} className="h-8 w-8 text-neutral-300" />
            <p className="text-sm text-neutral-500">
              No documents yet. Add an FAQ, policy, or note so the AI agent can answer questions
              from it.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
