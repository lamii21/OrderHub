import { google } from "googleapis";
import { buildUserOAuth2Client, getUserIdForShop } from "@/lib/google-oauth";
import { logger } from "@/lib/logger";

// Everything about *using* an already-connected Google account to touch
// Drive/Sheets. Credential-building itself (consent URL, code exchange,
// per-user OAuth2 client) lives in lib/google-oauth.ts — this file only
// ever takes a userId (or shopId, resolved to a userId) as input.
//
// Previously used a single shared service account (google.auth.JWT) whose
// drive.files.copy() call always failed for a real, non-Workspace Gmail
// merchant with "The user's Drive storage quota has been exceeded" — a
// service account has 0 bytes of its own Drive storage, and files.copy()
// creates the copy owned by the caller. Every spreadsheet is now created
// inside the connecting user's own Drive instead, which has real quota.

async function requireUserAuthClient(userId: string) {
  const authClient = await buildUserOAuth2Client(userId);
  if (!authClient) {
    throw new Error("No connected Google account for this user");
  }
  return authClient;
}

// Matches apps-script/sync-orders.gs's COL layout exactly (columns A-H).
const ORDERS_HEADER_ROW = [
  "Customer Name",
  "Customer Phone",
  "Customer City",
  "Customer Address",
  "Product",
  "Quantity",
  "Price",
  "Synced",
];

// If GOOGLE_SHEETS_TEMPLATE_ID is set, duplicates that template (keeping
// whatever formatting/Apps Script binding it has) and fills its Config tab.
// Otherwise creates a blank spreadsheet from scratch with the same two tabs
// and Orders header row — the template is a convenience, not a requirement.
// Either way, the file is created directly inside the connected user's own
// Drive (via their OAuth credentials), so no separate "share" step is
// needed afterward — unlike the old service-account flow, which had to
// explicitly share the copy it owned with the merchant's email.
export async function provisionShopSpreadsheet(
  userId: string,
  shopName: string,
  platform: string
): Promise<{ id: string; name: string }> {
  const authClient = await requireUserAuthClient(userId);
  const drive = google.drive({ version: "v3", auth: authClient });
  const sheets = google.sheets({ version: "v4", auth: authClient });

  const templateId = process.env.GOOGLE_SHEETS_TEMPLATE_ID;

  let spreadsheetId: string;
  let spreadsheetName: string;

  if (templateId) {
    const copy = await drive.files.copy({
      fileId: templateId,
      requestBody: { name: shopName },
    });
    spreadsheetId = copy.data.id!;
    spreadsheetName = copy.data.name!;
  } else {
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: shopName },
        sheets: [{ properties: { title: "Orders" } }, { properties: { title: "Config" } }],
      },
    });
    spreadsheetId = created.data.spreadsheetId!;
    spreadsheetName = created.data.properties?.title ?? shopName;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Orders!A1:H1",
      valueInputOption: "RAW",
      requestBody: { values: [ORDERS_HEADER_ROW] },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Config!B1:B2",
    valueInputOption: "RAW",
    requestBody: { values: [[shopName], [platform]] },
  });

  return { id: spreadsheetId, name: spreadsheetName };
}

// The one shared entry point for both shop-creation flows (/shops/new,
// /shops/connect) — replaces their direct provisionShopSpreadsheet() call so
// neither duplicates this fallback behavior itself. Shop creation must
// never block on Google: if the user hasn't connected a Google account yet,
// or the API call fails for any reason, the shop is still created with no
// spreadsheet — same graceful-degrade UX in every environment (this used to
// be dev-only, back when the blocker was missing local credentials; now
// that a first-time production user genuinely hasn't connected Google yet
// either, the same "don't block" behavior applies everywhere). A banner/
// link on the shop pages (components/google-account-card.tsx) is what gets
// them to connect and regenerate later. Never logs the caught error itself
// — same "never surface a raw error" rule this project applies elsewhere,
// applied here to a log line instead of a user-facing message.
export async function provisionShopSpreadsheetOrSkip(
  userId: string,
  shopName: string,
  platform: string
): Promise<{ id: string | null; name: string | null }> {
  try {
    return await provisionShopSpreadsheet(userId, shopName, platform);
  } catch {
    logger.warn("google_sheets.provisioning_skipped", { userId });
    return { id: null, name: null };
  }
}

// Appends rows to a shop's "Orders" tab, in the same column order the bound
// Apps Script (sync-orders.gs) reads from. This is how Shopify order sync
// hands off to the existing Sheet → Apps Script → webhook pipeline instead
// of writing to Supabase directly.
//
// Takes shopId (not userId) because both callers of this function
// (lib/sync.ts, lib/automation-modules/google-sheets.ts) have a shopId on
// hand, not a userId — resolving it here via getUserIdForShop() avoids
// adding userId to ShopForSync/SyncableShop or threading it through the
// AutomationModule interface, which deliberately never carries shop/tenant
// identity (see lib/automation-modules/types.ts).
export async function appendOrderRows(
  shopId: number,
  spreadsheetId: string,
  rows: (string | number)[][]
) {
  const userId = await getUserIdForShop(shopId);
  if (!userId) {
    throw new Error(`No owner found for shop ${shopId}`);
  }

  const authClient = await requireUserAuthClient(userId);
  const sheets = google.sheets({ version: "v4", auth: authClient });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Orders!A:G",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

// Appends one row to any spreadsheet/tab the merchant chooses — backs the
// Google Sheets automation module, which is a distinct, output-only use of
// Sheets from the ingestion pipeline above (appendOrderRows/the Apps
// Script). Same shopId-to-userId resolution as appendOrderRows above.
// Returns the updated range so the module can report which row it wrote,
// same shape Google's API itself returns.
export async function appendRowToSheet(
  shopId: number,
  spreadsheetId: string,
  sheetName: string,
  row: (string | number)[]
): Promise<{ updatedRange?: string }> {
  const userId = await getUserIdForShop(shopId);
  if (!userId) {
    throw new Error(`No owner found for shop ${shopId}`);
  }

  const authClient = await requireUserAuthClient(userId);
  const sheets = google.sheets({ version: "v4", auth: authClient });

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return { updatedRange: response.data.updates?.updatedRange ?? undefined };
}
