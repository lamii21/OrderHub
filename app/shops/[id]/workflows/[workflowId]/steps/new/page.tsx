import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/submit-button";
import { MODULE_CATALOG, getModuleCatalogEntry, type ModuleCategory } from "@/lib/automation-modules/catalog";
import { addWorkflowStep } from "../../actions";
import type { ShopWithStats } from "@/types/shop";

export const revalidate = 0;

type WorkflowRow = { id: number; name: string };

// Module Palette (no ?module=) and Properties Panel (?module=x) share this
// one route — UI specification §5/§6: the palette exists purely to choose
// a module, then hands off to the exact same page with the selection in
// the URL. Neither is a modal; both are their own page, consistent with
// every other creation flow in OrderHub ("New Shop", "Connect a Store", ...).
export default async function AddWorkflowStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; workflowId: string }>;
  searchParams: Promise<{ module?: string; error?: string }>;
}) {
  const { id, workflowId } = await params;
  const sp = await searchParams;

  const supabase = await createSupabaseServerClient();
  const { data: shops, error: shopError } = await supabase.rpc("get_shops_with_stats");

  if (shopError) {
    console.error("Add step page load failed:", shopError);
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
    console.error("Add step page load failed:", workflowError);
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

  const editorHref = `/shops/${shop.id}/workflows/${workflow.id}`;
  const moduleName = sp.module?.trim();

  if (moduleName) {
    return (
      <PropertiesPanel
        shopId={shop.id}
        workflowId={workflow.id}
        workflowName={workflow.name}
        moduleName={moduleName}
        error={sp.error}
      />
    );
  }

  const actionEntries = Object.entries(MODULE_CATALOG).filter(([, entry]) => entry.category === "action");
  const controlEntries = Object.entries(MODULE_CATALOG).filter(([, entry]) => entry.category === "control");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a Step</h1>
        <Link href={editorHref} className="text-sm text-blue-600 hover:underline">
          ← Back to {workflow.name}
        </Link>
      </div>

      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      <ModuleGrid title="Action Modules" entries={actionEntries} editorHref={editorHref} />
      <ModuleGrid title="Control Modules" entries={controlEntries} editorHref={editorHref} />
    </main>
  );
}

function ModuleGrid({
  title,
  entries,
  editorHref,
}: {
  title: string;
  entries: [string, { name: string; icon: string; purpose: string; category: ModuleCategory }][];
  editorHref: string;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {entries.map(([moduleName, entry]) => (
          <Link
            key={moduleName}
            href={`${editorHref}/steps/new?module=${encodeURIComponent(moduleName)}`}
            className="rounded-lg border bg-white p-4 text-center hover:border-blue-400 hover:bg-blue-50"
          >
            <div className="text-2xl">{entry.icon}</div>
            <div className="mt-1 text-sm font-semibold">{entry.name}</div>
            <div className="mt-1 text-xs text-gray-500">{entry.purpose}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PropertiesPanel({
  shopId,
  workflowId,
  workflowName,
  moduleName,
  error,
}: {
  shopId: number;
  workflowId: number;
  workflowName: string;
  moduleName: string;
  error?: string;
}) {
  const entry = getModuleCatalogEntry(moduleName);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {entry.icon} Configure: {entry.name}
        </h1>
        <Link
          href={`/shops/${shopId}/workflows/${workflowId}`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to {workflowName}
        </Link>
      </div>

      <form
        action={addWorkflowStep}
        className="space-y-3 rounded-lg border bg-white p-6"
      >
        <input type="hidden" name="shop_id" value={shopId} />
        <input type="hidden" name="workflow_id" value={workflowId} />
        <input type="hidden" name="module_name" value={moduleName} />

        <p className="text-xs text-gray-500">Expected fields: {entry.configHint}</p>

        {/* Localized right above the field, not a page-top banner — this
            form manipulates raw JSON, where knowing exactly which field the
            problem is in matters more than in the rest of the app's
            single-field forms (UI specification §6). */}
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {decodeURIComponent(error)}
          </p>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Configuration (JSON)</label>
          <textarea
            name="config"
            rows={6}
            defaultValue="{}"
            className="w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
        </div>

        <SubmitButton pendingLabel="Adding…">Save Step</SubmitButton>
      </form>
    </main>
  );
}
