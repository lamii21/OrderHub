"use server";

import { redirect } from "next/navigation";
import { provisionShopSpreadsheet } from "@/lib/google-sheets";
import { createOrUpdateShop } from "@/lib/shop";
import { isValidEmail } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function createShop(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const platform = String(formData.get("platform") ?? "").trim();
  const ownerEmail = String(formData.get("owner_email") ?? "").trim();

  if (!name || !platform || !ownerEmail) {
    redirect(
      `/shops/new?error=${encodeURIComponent(
        "Shop name, platform, and owner email are required."
      )}`
    );
  }

  if (!isValidEmail(ownerEmail)) {
    redirect(
      `/shops/new?error=${encodeURIComponent("Please enter a valid Google account email.")}`
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let sheetId: string;

  try {
    const sheet = await provisionShopSpreadsheet(name, platform, ownerEmail);
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
      `/shops/new?error=${encodeURIComponent(
        "Could not create the shop. Please check the Google integration is configured correctly and try again."
      )}`
    );
  }

  redirect(`/shops/new?sheet_id=${encodeURIComponent(sheetId)}`);
}
