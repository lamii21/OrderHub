import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EVENT_TYPES } from "@/lib/events/types";
import { AVAILABLE_MODULES } from "@/lib/automation-modules";
import { formatDuration } from "@/lib/utils";
import type { ShopWithStats } from "@/types/shop";
import type { WorkflowExecution, WorkflowStep } from "@/types/workflow";
import {
  updateWorkflowDetails,
  activateWorkflow,
  deactivateWorkflow,
  addWorkflowStep,
  updateWorkflowStep,
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

  // A secondary section — if this fails, the rest of the page (already
  // loaded fine above) still renders; only this table shows an inline
  // error, same pattern as the sync history table on /shops/[id].
  const { data: history, error: historyError } = await supabase
    .from("workflow_executions")
    .select("*")
    .eq("workflow_id", workflow.id)
    .order("started_at", { ascending: false })
    .limit(20)
    .returns<WorkflowExecution[]>();

  if (historyError) {
    console.error("Workflow execution history load failed:", historyError);
  }

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
          Test run complete — see Recent Executions below.
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
                  {eventType}
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

      {/* Zone 2 — Steps */}
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Steps</h2>

        {steps.length === 0 && (
          <p className="mb-4 text-sm text-gray-500">
            No steps yet. Add at least one below before activating this workflow.
          </p>
        )}

        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={step.id} className="rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-xs text-gray-500">Step {step.step_order}</span>
                <div className="flex items-center gap-2">
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

              {/* Each row is its own mini-form — no separate "edit mode" to
                  toggle, per the Builder specification's own wording. */}
              <form action={updateWorkflowStep} className="space-y-3">
                <input type="hidden" name="shop_id" value={shop.id} />
                <input type="hidden" name="workflow_id" value={workflow.id} />
                <input type="hidden" name="step_id" value={step.id} />
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Module</label>
                  <select
                    name="module_name"
                    required
                    defaultValue={step.module_name}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  >
                    {!AVAILABLE_MODULES.includes(step.module_name) && (
                      <option value={step.module_name}>{step.module_name} (unavailable)</option>
                    )}
                    {AVAILABLE_MODULES.map((moduleName) => (
                      <option key={moduleName} value={moduleName}>
                        {moduleName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Configuration (JSON)
                  </label>
                  <textarea
                    name="config"
                    rows={3}
                    defaultValue={JSON.stringify(step.config, null, 2)}
                    className="w-full rounded-md border px-3 py-2 font-mono text-xs"
                  />
                </div>
                <SubmitButton variant="secondary" pendingLabel="Saving…">
                  Save Step
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t pt-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Add Step</h3>
          {AVAILABLE_MODULES.length === 0 ? (
            <p className="text-sm text-gray-400">
              No automation modules are available yet — steps can&apos;t be added until a module
              is registered.
            </p>
          ) : (
            <form action={addWorkflowStep} className="space-y-3">
              <input type="hidden" name="shop_id" value={shop.id} />
              <input type="hidden" name="workflow_id" value={workflow.id} />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Module</label>
                <select name="module_name" required className="w-full rounded-md border px-3 py-2 text-sm">
                  {AVAILABLE_MODULES.map((moduleName) => (
                    <option key={moduleName} value={moduleName}>
                      {moduleName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Configuration (JSON)
                </label>
                <textarea
                  name="config"
                  rows={3}
                  defaultValue="{}"
                  className="w-full rounded-md border px-3 py-2 font-mono text-xs"
                />
              </div>
              <SubmitButton variant="secondary" pendingLabel="Adding…">
                Add Step
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      {/* Zone 3 — Recent executions (read-only) */}
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Recent Executions</h2>
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
                      <span
                        className={entry.status === "success" ? "text-green-700" : "text-red-700"}
                      >
                        {entry.status === "success" ? "Success" : "Failed"}
                      </span>
                    </TableCell>
                    <TableCell>{formatDuration(entry.duration_ms)}</TableCell>
                    <TableCell>{entry.message ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(!history || history.length === 0) && (
              <p className="p-4 text-center text-gray-500">No executions yet.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
