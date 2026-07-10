import { google } from "googleapis";
import { requireEnv } from "@/lib/env";

// Server-only client (service account). Never import this from a "use client" component.
//
// Built lazily (only when a provisioning action actually runs), not at module
// load: this integration is optional, and eagerly validating its env vars at
// import time would make every page that transitively imports this file
// (including unrelated ones) fail to even build/start if Google credentials
// aren't configured yet.
let auth: InstanceType<typeof google.auth.JWT> | null = null;

function getAuth() {
  if (!auth) {
    auth = new google.auth.JWT({
      email: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      key: requireEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
      // drive.file (not the full drive scope) — this service account only
      // ever touches two kinds of files: the template it copies (must be
      // explicitly shared with the service account email, which "opens" it
      // for drive.file purposes) and the per-shop copies it creates itself.
      // Narrower scope, same functionality, smaller blast radius if the
      // service account key ever leaks.
      scopes: [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });
  }
  return auth;
}

// Duplicates the OrderHub spreadsheet template, fills in its Config tab, and
// shares the copy with the merchant's own Google account (the service account
// owns the copy, so without this share the merchant can't open it at all).
export async function provisionShopSpreadsheet(
  shopName: string,
  platform: string,
  ownerEmail: string
) {
  const drive = google.drive({ version: "v3", auth: getAuth() });
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

  const copy = await drive.files.copy({
    fileId: requireEnv("GOOGLE_SHEETS_TEMPLATE_ID"),
    requestBody: { name: shopName },
  });

  const spreadsheetId = copy.data.id!;
  const spreadsheetName = copy.data.name!;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Config!B1:B2",
    valueInputOption: "RAW",
    requestBody: { values: [[shopName], [platform]] },
  });

  await drive.permissions.create({
    fileId: spreadsheetId,
    sendNotificationEmail: true,
    requestBody: { role: "writer", type: "user", emailAddress: ownerEmail },
  });

  return { id: spreadsheetId, name: spreadsheetName };
}

// Appends rows to a shop's "Orders" tab, in the same column order the bound
// Apps Script (sync-orders.gs) reads from. This is how Shopify order sync
// hands off to the existing Sheet → Apps Script → webhook pipeline instead
// of writing to Supabase directly.
export async function appendOrderRows(spreadsheetId: string, rows: (string | number)[][]) {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

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
// Script). Same service account, same auth — the only new thing is that
// the spreadsheet/tab is a per-step config value instead of the shop's own
// provisioned sheet. Returns the updated range so the module can report
// which row it wrote, same shape Google's API itself returns.
export async function appendRowToSheet(
  spreadsheetId: string,
  sheetName: string,
  row: (string | number)[]
): Promise<{ updatedRange?: string }> {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return { updatedRange: response.data.updates?.updatedRange ?? undefined };
}
