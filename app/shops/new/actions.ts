"use server";

import { redirect } from "next/navigation";
import { provisionShopSpreadsheetOrSkip } from "@/lib/google-sheets";
import { createOrUpdateShop } from "@/lib/shop";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function createShop(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const platform = String(formData.get("platform") ?? "").trim();

  if (!name || !platform) {
    redirect(`/shops/new?error=${encodeURIComponent("Shop name and platform are required.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let sheetId: string | null;

  try {
    // Never blocks shop creation: if this user hasn't connected a Google
    // account yet (or the API call fails), the shop is still created with
    // no spreadsheet — see provisionShopSpreadsheetOrSkip's own comment.
    const sheet = await provisionShopSpreadsheetOrSkip(user.id, name, platform);
    await createOrUpdateShop({
      name,
      platform,
      sheetId: sheet.id,
      sheetName: sheet.name,
      userId: user.id,
    });
    sheetId = sheet.id;
  } catch (err) {
    console.error("Failed to create shop:", err);
    redirect(
      `/shops/new?error=${encodeURIComponent("Could not create the shop. Please try again.")}`
    );
  }

  // sheetId is only null when Google provisioning was skipped (no connected
  // Google account, or the API call failed — see
  // provisionShopSpreadsheetOrSkip) — the success page's own sheet_id check
  // already treats a missing param as "show the form again", which is the
  // right fallback here since there's no spreadsheet to show.
  redirect(sheetId ? `/shops/new?sheet_id=${encodeURIComponent(sheetId)}` : "/shops/new");
}
