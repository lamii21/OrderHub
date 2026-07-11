import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { StatCard } from "@/components/stat-card";
import { ExecutionStatusLabel } from "@/components/execution-status-label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EVENT_TYPES, getEventTypeLabel } from "@/lib/events/types";
import { getModuleCatalogEntry, summarizeStepConfig } from "@/lib/automation-modules/catalog";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import type { ShopWithStats } from "@/types/shop";
import type { WorkflowExecution, WorkflowStep, WorkflowWithStats } from "@/types/workflow";
import {
  updateWorkflowDetails,
  activateWorkflow,
  deactivateWorkflow,
  removeWorkflowStep,
  moveWorkflowStepUp,
  moveWorkflowStepDown,
  runWorkflowNow,
} from "./actions";

export const revalidate = 0;

type SearchParams = {
  activated?: string;
  deactivated?: string;
  tested?: string;
  error?: string;
};

type WorkflowRow = {
  id: number;
  name: string;
  trigger_event: string;
  is_active: boolean;
  activated_at: string | null;
  workflow_steps: WorkflowStep[];
};

export default async function WorkflowEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; workflowId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id, workflowId } = await params;
  const sp = await searchParams;

  // Same RPC every other shop page already uses, just for the shop's name
  // and to confirm ownership before rendering.
  const supabase = await createSupabaseServerClient();
  const { data: shops, error: shopError } = await supabase.rpc("get_shops_with_stats");

  if (shopError) {
    console.error("Workflow editor load failed:", shopError);
    return (
      <ErrorBanner message="We couldn't load this workflow right now. Please refresh the page in a moment." />
    );
  }

  const shop = (shops as ShopWithStats[]).find((s) => s.id === Number(id));

  if (!shop) {
    notFound();
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("workflows")
    .select("id, name, trigger_event, is_active, activated_at, workflow_steps(*)")
    .eq("id", workflowId)
    .eq("shop_id", shop.id)
    .maybeSingle<WorkflowRow>();

  if (workflowError) {
    console.error("Workflow editor load failed:", workflowError);
    return (
      <ErrorBanner message="We couldn't load this workflow right now. Please refresh the page in a moment." />
    );
  }

  if (!workflow) {
    notFound();
  }

  const steps = [...workflow.workflow_steps].sort((a, b) => a.step_order - b.step_order);

  // Both secondary sections — if either fails, the rest of the page
  // (already loaded fine above) still renders; only that section shows an
  // inline error, same pattern as the sync history table on /shops/[id].
  const [historyResult, statsResult] = await Promise.all([
    supabase
      .from("workflow_executions")
      .select("*")
      .eq("workflow_id", workflow.id)
      .order("started_at", { ascending: false })
      .limit(20)
      .returns<WorkflowExecution[]>(),
    // Reuses the same aggregate the Workflow List and /admin already read
    // (UI specification §8) — filtered down to this one workflow in JS,
    // same "fetch via RPC, then find()" shape as the shop lookup above.
    supabase.rpc("get_workflows_with_stats"),
  ]);

  const { data: history, error: historyError } = historyResult;
  if (historyError) {
    console.error("Workflow execution history load failed:", historyError);
  }

  if (statsResult.error) {
    console.error("Workflow statistics load failed:", statsResult.error);
  }
  const stats = ((statsResult.data ?? []) as WorkflowWithStats[]).find((w) => w.id === workflow.id) ?? null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{workflow.name}</h1>
          <Link href={`/shops/${shop.id}/workflows`} className="text-sm text-blue-600 hover:underline">
            ← Back to Workflows
          </Link>
        </div>
        <span
          className={
            workflow.is_active
              ? "rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700"
              : "rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600"
          }
        >
          {workflow.is_active ? "Active" : "Draft"}
        </span>
      </div>

      {sp.activated !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Workflow activated.
        </p>
      )}
      {sp.deactivated !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Workflow deactivated.
        </p>
      )}
      {sp.tested !== undefined && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Test run complete — see Execution History below.
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      {/* Zone 1 — General information */}
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">General Information</h2>
        <form action={updateWorkflowDetails} className="space-y-4">
          <input type="hidden" name="shop_id" value={shop.id} />
          <input type="hidden" name="workflow_id" value={workflow.id} />
          <FormField id="name" name="name" label="Workflow Name" required />
          <div>
            <label htmlFor="trigger_event" className="mb-1 block text-sm font-medium text-gray-700">
              Trigger Event
            </label>
            <select
              id="trigger_event"
              name="trigger_event"
              required
              defaultValue={workflow.trigger_event}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {EVENT_TYPES.map((eventType) => (
                <option key={eventType} value={eventType}>
                  {getEventTypeLabel(eventType)}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </form>

        <div className="mt-4 flex items-center gap-3 border-t pt-4">
          <form action={workflow.is_active ? deactivateWorkflow : activateWorkflow}>
            <input type="hidden" name="shop_id" value={shop.id} />
            <input type="hidden" name="workflow_id" value={workflow.id} />
            <SubmitButton pendingLabel={workflow.is_active ? "Deactivating…" : "Activating…"}>
              {workflow.is_active ? "Deactivate" : "Activate"}
            </SubmitButton>
          </form>

          <form action={runWorkflowNow}>
            <input type="hidden" name="shop_id" value={shop.id} />
            <input type="hidden" name="workflow_id" value={workflow.id} />
            <SubmitButton variant="secondary" pendingLabel="Testing…">
              Test Workflow Now
            </SubmitButton>
          </form>
        </div>
      </div>

      {/* Zone 3 — The flow (the "Visual Editor": a stacked column of step
          cards connected by simple arrows, not a drag-and-drop canvas — UI
          specification, "Réconciliation du vocabulaire"). Editing a step
          navigates to its own Properties Panel page instead of expanding
          an inline form (§6); adding one navigates to the Module Palette
          (§5). */}
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Steps</h2>

        {steps.length === 0 ? (
          <div className="mb-2 rounded-md border border-dashed p-6 text-center">
            <p className="mb-3 text-sm text-gray-500">This workflow has no steps yet.</p>
            <Link
              href={`/shops/${shop.id}/workflows/${workflow.id}/steps/new`}
              className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Add your first step
            </Link>
          </div>
        ) : (
          <div className="mx-auto max-w-md space-y-0">
            {steps.map((step, index) => {
              const entry = getModuleCatalogEntry(step.module_name);
              return (
                <div key={step.id}>
                  <div className="rounded-md border p-4">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold text-blue-600">{step.step_order}</span>
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold">
                        {entry.icon} {entry.name}
                      </span>
                      <span className="flex-1 truncate text-xs text-gray-500">
                        {summarizeStepConfig(step.module_name, step.config)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-3 border-t pt-3 text-xs">
                      <form action={moveWorkflowStepUp}>
                        <input type="hidden" name="shop_id" value={shop.id} />
                        <input type="hidden" name="workflow_id" value={workflow.id} />
                        <input type="hidden" name="step_id" value={step.id} />
                        <SubmitButton variant="secondary" pendingLabel="…">
                          {index === 0 ? <span className="opacity-30">↑</span> : "↑"}
                        </SubmitButton>
                      </form>
                      <form action={moveWorkflowStepDown}>
                        <input type="hidden" name="shop_id" value={shop.id} />
                        <input type="hidden" name="workflow_id" value={workflow.id} />
                        <input type="hidden" name="step_id" value={step.id} />
                        <SubmitButton variant="secondary" pendingLabel="…">
                          {index === steps.length - 1 ? <span className="opacity-30">↓</span> : "↓"}
                        </SubmitButton>
                      </form>
                      <Link
                        href={`/shops/${shop.id}/workflows/${workflow.id}/steps/${step.id}/edit`}
                        className="rounded-md border px-4 py-2 font-medium hover:bg-gray-50"
                      >
                        Edit
                      </Link>
                      <ConfirmActionForm
                        shopId={shop.id}
                        action={removeWorkflowStep}
                        buttonLabel="Delete"
                        pendingLabel="Deleting…"
                        confirmMessage={`Remove step ${step.step_order} (${step.module_name})?`}
                      >
                        <input type="hidden" name="workflow_id" value={workflow.id} />
                        <input type="hidden" name="step_id" value={step.id} />
                      </ConfirmActionForm>
                    </div>
                  </div>
                  {index < steps.length - 1 && (
                    <div className="py-1 text-center font-mono text-gray-400">↓</div>
                  )}
                </div>
              );
            })}
            <div className="pt-4 text-center">
              <Link
                href={`/shops/${shop.id}/workflows/${workflow.id}/steps/new`}
                className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                + Add Step
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Zone 4 — Statistics (UI specification §8), stacked above Execution
          History (§7) — same StatCard row already used on the Dashboard,
          /shops/[id], and /admin. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Runs" value={stats ? stats.execution_count : "—"} />
        <StatCard
          label="Success Rate"
          value={stats && stats.execution_count > 0 ? `${Math.round((stats.success_count / stats.execution_count) * 100)}%` : "—"}
        />
        <StatCard
          label="Last Run"
          value={stats?.last_execution_at ? formatRelativeTime(new Date(stats.last_execution_at)) : "—"}
        />
        <StatCard
          label="Avg Duration"
          value={stats?.avg_duration_ms ? formatDuration(Number(stats.avg_duration_ms)) : "—"}
        />
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Execution History</h2>
        {historyError ? (
          <p className="text-sm text-red-600">Couldn&apos;t load execution history.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{new Date(entry.started_at).toLocaleString()}</TableCell>
                    <TableCell>{entry.step_order}</TableCell>
                    <TableCell>{entry.module_name}</TableCell>
                    <TableCell>
                      <ExecutionStatusLabel entry={entry} />
                    </TableCell>
                    <TableCell>{formatDuration(entry.duration_ms)}</TableCell>
                    <TableCell>{entry.message ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(!history || history.length === 0) && (
              <p className="p-4 text-center text-gray-500">
                No executions yet. Activate this workflow or use &quot;Test Workflow Now&quot; to see
                results here.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
