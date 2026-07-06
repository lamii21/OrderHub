import { supabase } from "@/lib/supabase";

export type ShopInput = {
  name: string;
  platform: string;
  sheetId: string | null;
  sheetName: string | null;
  // Omitted by the webhook, which has no logged-in user to attribute the
  // shop to — only /shops/new and /shops/connect (called by an authenticated
  // user) pass this, so a webhook-only upsert never overwrites the owner.
  userId?: string;
  shopifyStoreUrl?: string;
  shopifyAccessToken?: string;
};

// The single place every code path goes through to create or refresh a shop,
// keyed on sheet_id (the one identifier every shop is guaranteed to have —
// every shop either arrives with one already, or gets one provisioned before
// this is called). Replaces what used to be 3 separate, drifting
// implementations: the webhook, /shops/new, and /shops/connect each had
// their own insert/upsert logic.
export async function createOrUpdateShop(input: ShopInput) {
  const { data, error } = await supabase
    .from("shops")
    .upsert(
      {
        name: input.name,
        platform: input.platform,
        sheet_id: input.sheetId,
        sheet_name: input.sheetName,
        ...(input.userId !== undefined && { user_id: input.userId }),
        ...(input.shopifyStoreUrl !== undefined && { shopify_store_url: input.shopifyStoreUrl }),
        ...(input.shopifyAccessToken !== undefined && {
          shopify_access_token: input.shopifyAccessToken,
        }),
      },
      { onConflict: "sheet_id" }
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
