import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/submit-button";
import { getModuleCatalogEntry } from "@/lib/automation-modules/catalog";
import { updateWorkflowStep } from "../../../actions";
import type { ShopWithStats } from "@/types/shop";

export const revalidate = 0;

type WorkflowRow = { id: number; name: string };
type StepRow = { id: number; workflow_id: number; module_name: string; config: Record<string, unknown> };

// The edit half of the Properties Panel (UI specification §6) — its own
// page, not a modal, same as the add half at .../steps/new. The module a
// step uses is fixed here (shown, not re-selectable): swapping a step's
// module entirely is a remove-and-re-add through the Module Palette, not
// an edit — keeps this form to exactly the one thing it's for, configuring
// the module already chosen.
export default async function EditWorkflowStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; workflowId: string; stepId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, workflowId, stepId } = await params;
  const sp = await searchParams;

  const supabase = await createSupabaseServerClient();
  const { data: shops, error: shopError } = await supabase.rpc("get_shops_with_stats");

  if (shopError) {
    console.error("Edit step page load failed:", shopError);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          We couldn&apos;t load this page right now. Please refresh in a moment.
        </p>
      </main>
    );
  }

  const shop = (shops as ShopWithStats[]).find((s) => s.id === Number(id));
  if (!shop) {
    notFound();
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("workflows")
    .select("id, name")
    .eq("id", workflowId)
    .eq("shop_id", shop.id)
    .maybeSingle<WorkflowRow>();

  if (workflowError) {
    console.error("Edit step page load failed:", workflowError);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          We couldn&apos;t load this page right now. Please refresh in a moment.
        </p>
      </main>
    );
  }
  if (!workflow) {
    notFound();
  }

  const { data: step, error: stepError } = await supabase
    .from("workflow_steps")
    .select("id, workflow_id, module_name, config")
    .eq("id", stepId)
    .eq("workflow_id", workflow.id)
    .maybeSingle<StepRow>();

  if (stepError) {
    console.error("Edit step page load failed:", stepError);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          We couldn&apos;t load this page right now. Please refresh in a moment.
        </p>
      </main>
    );
  }
  if (!step) {
    notFound();
  }

  const entry = getModuleCatalogEntry(step.module_name);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {entry.icon} Configure: {entry.name}
        </h1>
        <Link
          href={`/shops/${shop.id}/workflows/${workflow.id}`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to {workflow.name}
        </Link>
      </div>

      <form action={updateWorkflowStep} className="space-y-3 rounded-lg border bg-white p-6">
        <input type="hidden" name="shop_id" value={shop.id} />
        <input type="hidden" name="workflow_id" value={workflow.id} />
        <input type="hidden" name="step_id" value={step.id} />
        <input type="hidden" name="module_name" value={step.module_name} />

        <p className="text-xs text-gray-500">Expected fields: {entry.configHint}</p>

        {/* Localized right above the field, not a page-top banner — same
            reasoning as the add page (UI specification §6). */}
        {sp.error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {decodeURIComponent(sp.error)}
          </p>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Configuration (JSON)</label>
          <textarea
            name="config"
            rows={6}
            defaultValue={JSON.stringify(step.config, null, 2)}
            className="w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
        </div>

        <SubmitButton pendingLabel="Saving…">Save Step</SubmitButton>
      </form>
    </main>
  );
}
