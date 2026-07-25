"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { invalidateModuleCredentialsCache } from "@/lib/automation-modules/credentials";
import { CREDENTIAL_MODULES, isCredentialModuleName } from "@/lib/module-credential-fields";
import { logger } from "@/lib/logger";

// RLS-scoped client only, same pattern as every other action in this
// folder (settings/actions.ts): "Users can insert/update credentials for
// their own shops" (supabase/schema.sql) already rejects a shop_id that
// isn't the caller's own — no separate ownership check needed here.
//
// Credentials are stored as plain JSON in module_credentials.credentials,
// exactly as every automation module already reads them (getModuleCredentials,
// lib/automation-modules/credentials.ts) — none of the 7 modules that
// consume this table decrypt anything today, so encrypting on write here
// without also updating every one of them would silently break every
// automation (a real token replaced by ciphertext the module can't use).
// Same storage posture the shops table already uses for platform
// api_key/api_secret: plain columns behind RLS, not encrypted at rest.
export async function saveModuleCredentials(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const moduleName = String(formData.get("module_name") ?? "");

  if (!isCredentialModuleName(moduleName)) {
    redirect(`/shops/${shopId}/integrations?error=${encodeURIComponent("Unknown module.")}`);
  }

  const moduleSpec = CREDENTIAL_MODULES[moduleName];
  const supabase = await createSupabaseServerClient();

  // Credentials are never sent back to the page (see the page component),
  // so a field left blank here must mean "keep the existing value," not
  // "clear it" — otherwise updating just one field would force retyping
  // every other secret from memory. Merge submitted fields over whatever
  // is already stored rather than replacing the row outright.
  const { data: existingRow } = await supabase
    .from("module_credentials")
    .select("credentials")
    .eq("shop_id", shopId)
    .eq("module_name", moduleName)
    .maybeSingle();

  const credentials: Record<string, string> = {
    ...((existingRow?.credentials as Record<string, string>) ?? {}),
  };

  for (const field of moduleSpec.fields) {
    const value = String(formData.get(field.name) ?? "").trim();
    if (value) {
      credentials[field.name] = value;
    }
  }

  const missingRequired = moduleSpec.fields.find((field) => field.required && !credentials[field.name]);
  if (missingRequired) {
    redirect(
      `/shops/${shopId}/integrations?error=${encodeURIComponent(
        `${missingRequired.label} is required for ${moduleSpec.label}.`
      )}`
    );
  }

  const { error } = await supabase
    .from("module_credentials")
    .upsert(
      { shop_id: Number(shopId), module_name: moduleName, credentials },
      { onConflict: "shop_id,module_name" }
    );

  if (error) {
    console.error("saveModuleCredentials failed:", error);
    redirect(
      `/shops/${shopId}/integrations?error=${encodeURIComponent("Could not save credentials.")}`
    );
  }

  // Without this, a merchant who just rotated a leaked token would keep
  // hitting the old (or "not configured") value for up to the cache's
  // CACHE_TTL_MS — invalidateModuleCredentialsCache's own comment names
  // this exact use case.
  invalidateModuleCredentialsCache(Number(shopId), moduleName);

  logger.audit("module_credentials.saved", { shopId, moduleName });
  redirect(`/shops/${shopId}/integrations?saved=${moduleName}`);
}

export async function deleteModuleCredentials(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const moduleName = String(formData.get("module_name") ?? "");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("module_credentials")
    .delete()
    .eq("shop_id", shopId)
    .eq("module_name", moduleName);

  if (error) {
    console.error("deleteModuleCredentials failed:", error);
    redirect(
      `/shops/${shopId}/integrations?error=${encodeURIComponent("Could not remove credentials.")}`
    );
  }

  invalidateModuleCredentialsCache(Number(shopId), moduleName);
  logger.audit("module_credentials.deleted", { shopId, moduleName });
  redirect(`/shops/${shopId}/integrations?removed=${moduleName}`);
}
