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
  storeUrl?: string;
  apiKey?: string;
  apiSecret?: string;
};

// The single place every code path goes through to create or refresh a shop.
// Upserts on sheet_id when one is available — but sheet_id can be null (no
// Google account connected yet, see provisionShopSpreadsheetOrSkip), and
// Postgres never treats two NULLs as equal under a UNIQUE constraint, so that
// upsert can never find an existing sheet_id-less row: every call from an
// authenticated user would insert a fresh duplicate row instead of updating
// the one already there. When sheetId is null and a userId is present, look
// up the existing row first — matched on store_url (a real external
// identifier) when the caller has one (connectShop), falling back to
// name+platform for Sheets-only shops (createShop, which never has a
// store_url at all). The webhook (app/api/orders/route.ts) never passes
// userId, so it always falls through to the plain upsert below, unchanged.
//
// This SELECT-then-branch isn't atomic — a genuine concurrent double-submit
// of the same form could still race past the SELECT and insert twice — but
// every path here is a human clicking "Create"/"Connect" once, not a
// high-frequency concurrent writer; an accepted trade-off, not an oversight.
export async function createOrUpdateShop(input: ShopInput) {
  if (!input.sheetId && input.userId) {
    const lookup = supabase
      .from("shops")
      .select("id")
      .eq("user_id", input.userId)
      .eq("platform", input.platform);

    // .limit(1) matters even though this column combination isn't declared
    // unique in the database: the duplicate rows this branch exists to stop
    // (see the function comment above) already exist in production for
    // exactly this (user_id, platform, name/store_url) combination. Without
    // it, .maybeSingle() against >1 matching rows returns
    // { data: null, error: PGRST116 } instead of throwing — uncaught here —
    // so an already-duplicated shop would silently look like "no match" and
    // fall through to yet another insert, compounding the bug instead of
    // converging on one row.
    const { data: existing } = await (
      input.storeUrl ? lookup.eq("store_url", input.storeUrl) : lookup.eq("name", input.name)
    )
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from("shops")
        .update({
          name: input.name,
          platform: input.platform,
          ...(input.storeUrl !== undefined && { store_url: input.storeUrl }),
          ...(input.apiKey !== undefined && { api_key: input.apiKey }),
          ...(input.apiSecret !== undefined && { api_secret: input.apiSecret }),
        })
        .eq("id", existing.id)
        .select("id")
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return data;
    }
  }

  const { data, error } = await supabase
    .from("shops")
    .upsert(
      {
        name: input.name,
        platform: input.platform,
        sheet_id: input.sheetId,
        sheet_name: input.sheetName,
        ...(input.userId !== undefined && { user_id: input.userId }),
        ...(input.storeUrl !== undefined && { store_url: input.storeUrl }),
        ...(input.apiKey !== undefined && { api_key: input.apiKey }),
        ...(input.apiSecret !== undefined && { api_secret: input.apiSecret }),
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
