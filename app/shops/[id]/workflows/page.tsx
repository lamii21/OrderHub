import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ErrorBanner } from "@/components/error-banner";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { SubmitButton } from "@/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEventTypeLabel } from "@/lib/events/types";
import { formatRelativeTime } from "@/lib/utils";
import { deleteWorkflow } from "./actions";
import { activateWorkflow, deactivateWorkflow } from "./[workflowId]/actions";
import type { ShopWithStats } from "@/types/shop";
import type { WorkflowWithStats } from "@/types/workflow";

export const revalidate = 0;

type SearchParams = { deleted?: string; error?: string };

export default async function WorkflowListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // Same RPC every other shop page already uses, just to confirm ownership
  // and get the shop's name for the header — reused rather than a
  // workflows-specific shop lookup.
  const supabase = await createSupabaseServerClient();
  const { data: shops, error: shopError } = await supabase.rpc("get_shops_with_stats");

  if (shopError) {
    console.error("Workflow list load failed:", shopError);
    return (
      <ErrorBanner message="We couldn't load this shop's workflows right now. Please refresh the page in a moment." />
    );
  }

  const shop = (shops as ShopWithStats[]).find((s) => s.id === Number(id));

  if (!shop) {
    notFound();
  }

  // Same aggregate the Workflow Editor's Statistics section and /admin's
  // Workflow Statistics table already read (UI specification §1/§8) —
  // filtered down to this shop in JS, same "fetch via RPC, then filter"
  // shape as the shop lookup above.
  const { data: workflowsStats, error: workflowsError } = await supabase.rpc("get_workflows_with_stats");

  if (workflowsError) {
    console.error("Workflow list load failed:", workflowsError);
    return (
      <ErrorBanner message="We couldn't load this shop's workflows right now. Please refresh the page in a moment." />
    );
  }

  const workflows = ((workflowsStats ?? []) as WorkflowWithStats[]).filter((w) => w.shop_id === shop.id);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{shop.name} — Workflows</h1>
          <Link href={`/shops/${shop.id}`} className="text-sm text-blue-600 hover:underline">
            ← Back to {shop.name}
          </Link>
        </div>
        <Link
          href={`/shops/${shop.id}/workflows/new`}
          className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New Workflow
        </Link>
      </div>

      {sp.deleted !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Workflow deleted.
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
              <TableHead>Name</TableHead>
              <TableHead>Trigger Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Steps</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead>Success Rate</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((workflow) => (
              <TableRow key={workflow.id}>
                <TableCell>
                  <Link
                    href={`/shops/${shop.id}/workflows/${workflow.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {workflow.name}
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{getEventTypeLabel(workflow.trigger_event)}</TableCell>
                <TableCell>
                  <span
                    className={
                      workflow.is_active
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"
                        : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600"
                    }
                  >
                    {workflow.is_active ? "Active" : "Draft"}
                  </span>
                </TableCell>
                <TableCell>{workflow.step_count}</TableCell>
                <TableCell>
                  {workflow.last_execution_at ? formatRelativeTime(new Date(workflow.last_execution_at)) : "Never"}
                </TableCell>
                <TableCell>
                  {workflow.execution_count > 0
                    ? `${Math.round((workflow.success_count / workflow.execution_count) * 100)}%`
                    : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/shops/${shop.id}/workflows/${workflow.id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Edit
                    </Link>
                    <form action={workflow.is_active ? deactivateWorkflow : activateWorkflow}>
                      <input type="hidden" name="shop_id" value={shop.id} />
                      <input type="hidden" name="workflow_id" value={workflow.id} />
                      <SubmitButton
                        variant="secondary"
                        pendingLabel={workflow.is_active ? "Deactivating…" : "Activating…"}
                      >
                        {workflow.is_active ? "Deactivate" : "Activate"}
                      </SubmitButton>
                    </form>
                    <ConfirmActionForm
                      shopId={shop.id}
                      action={deleteWorkflow}
                      buttonLabel="Delete"
                      pendingLabel="Deleting…"
                      confirmMessage={`Delete workflow "${workflow.name}"? This also deletes its steps and cannot be undone.`}
                    >
                      <input type="hidden" name="workflow_id" value={workflow.id} />
                    </ConfirmActionForm>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {workflows.length === 0 && (
          <p className="p-6 text-center text-gray-500">
            No workflows yet. Create one to automate what happens when an order comes in.
          </p>
        )}
      </div>
    </main>
  );
}
