import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { CREDENTIAL_MODULES, CREDENTIAL_MODULE_NAMES } from "@/lib/module-credential-fields";
import { saveModuleCredentials, deleteModuleCredentials } from "./actions";

export const revalidate = 0;

type SearchParams = {
  saved?: string;
  removed?: string;
  error?: string;
};

export default async function ShopIntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = await createSupabaseServerClient();

  // RLS's "Users can view their own shops" policy is what actually stops
  // this from returning another user's shop for a guessed id.
  const [{ data: shop, error: shopError }, { data: configuredRows, error: credsError }] =
    await Promise.all([
      supabase.from("shops").select("id, name").eq("id", id).single(),
      // Only module_name is selected, never credentials — this page must
      // never transport a stored secret back to the browser, only whether
      // one exists.
      supabase.from("module_credentials").select("module_name").eq("shop_id", id),
    ]);

  if (shopError || !shop) {
    notFound();
  }

  if (credsError) {
    console.error("Shop integrations: failed to load configured modules:", credsError);
  }

  const configured = new Set((configuredRows ?? []).map((row) => row.module_name));

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{shop.name} — Integrations</h1>
        <Link href={`/shops/${shop.id}/settings`} className="text-sm text-blue-600 hover:underline">
          ← Back to Settings
        </Link>
      </div>

      <p className="text-sm text-gray-500">
        Credentials for the automation modules used by this shop&apos;s workflows. Saved values are
        never shown again after you leave this page — leave a field blank to keep its current value.
      </p>

      {sp.saved && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {CREDENTIAL_MODULES[sp.saved as keyof typeof CREDENTIAL_MODULES]?.label ?? sp.saved}{" "}
          credentials saved.
        </p>
      )}
      {sp.removed && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {CREDENTIAL_MODULES[sp.removed as keyof typeof CREDENTIAL_MODULES]?.label ?? sp.removed}{" "}
          credentials removed.
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      {CREDENTIAL_MODULE_NAMES.map((moduleName) => {
        const moduleSpec = CREDENTIAL_MODULES[moduleName];
        const isConfigured = configured.has(moduleName);

        return (
          <div key={moduleName} className="rounded-lg border bg-white p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{moduleSpec.label}</h2>
              <span
                className={
                  isConfigured
                    ? "inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                    : "inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500"
                }
              >
                {isConfigured ? "Configured" : "Not configured"}
              </span>
            </div>
            <p className="mb-4 text-sm text-gray-500">{moduleSpec.description}</p>

            <form action={saveModuleCredentials} className="space-y-3">
              <input type="hidden" name="shop_id" value={shop.id} />
              <input type="hidden" name="module_name" value={moduleName} />

              {moduleSpec.fields.map((field) => (
                <div key={field.name}>
                  <label
                    htmlFor={`${moduleName}-${field.name}`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    {field.label}
                  </label>
                  <input
                    id={`${moduleName}-${field.name}`}
                    name={field.name}
                    type={field.type}
                    placeholder={isConfigured ? "Already set — leave blank to keep" : undefined}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              ))}

              <SubmitButton variant="secondary" pendingLabel="Saving…">
                {isConfigured ? "Update Credentials" : "Save Credentials"}
              </SubmitButton>
            </form>

            {isConfigured && (
              <div className="mt-3">
                <ConfirmActionForm
                  shopId={shop.id}
                  action={deleteModuleCredentials}
                  buttonLabel="Remove"
                  pendingLabel="Removing…"
                  confirmMessage={`Remove ${moduleSpec.label} credentials for "${shop.name}"? Any workflow step using this module will fail until it's configured again.`}
                >
                  <input type="hidden" name="module_name" value={moduleName} />
                </ConfirmActionForm>
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}
