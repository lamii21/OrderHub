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
      scopes: [
        "https://www.googleapis.com/auth/drive",
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
