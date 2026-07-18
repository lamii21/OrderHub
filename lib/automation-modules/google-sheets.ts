import { appendRowToSheet } from "@/lib/google-sheets";
import type { AutomationModule } from "./types";

// Not to be confused with the Google Sheet generated automatically when a
// shop connects (the ingestion pipeline's entry point) — this module
// writes to a *different*, merchant-chosen Sheet, used as an output (e.g.
// a custom tracking board, or a Sheet shared with a partner). Reuses
// lib/google-sheets.ts's appendRowToSheet — just a new call site with a
// configurable spreadsheet/tab instead of the shop's own provisioned one.
type GoogleSheetsConfig = { spreadsheetId: string; sheetName: string };

export const googleSheetsModule: AutomationModule = {
  validateConfig(config) {
    const { spreadsheetId, sheetName } = config as Partial<GoogleSheetsConfig>;

    if (typeof spreadsheetId !== "string" || spreadsheetId.trim() === "") {
      return "Google Sheets requires a spreadsheet ID.";
    }

    if (typeof sheetName !== "string" || sheetName.trim() === "") {
      return "Google Sheets requires a sheet (tab) name.";
    }

    return null;
  },

  async run(order, config) {
    const { spreadsheetId, sheetName } = config as GoogleSheetsConfig;

    if (order.shop_id === null) {
      return { success: false, message: "Order has no associated shop." };
    }

    try {
      const result = await appendRowToSheet(order.shop_id, spreadsheetId, sheetName, [
        order.created_at,
        order.customer_name ?? "",
        order.customer_phone ?? "",
        order.customer_city ?? "",
        order.product ?? "",
        order.quantity ?? "",
        order.price ?? "",
        order.status,
      ]);

      return {
        success: true,
        message: "Row appended to the Google Sheet.",
        data: result.updatedRange ? { updatedRange: result.updatedRange } : undefined,
      };
    } catch (err) {
      // Covers the catalog's listed failures (the shop's owner hasn't
      // connected Google, the sheet isn't accessible to them, tab renamed/
      // deleted, Google API quota) — all surface as a thrown error, never
      // distinguishable cheaply enough to warrant separate handling here.
      console.error("googleSheetsModule: append failed:", err);
      return { success: false, message: "Could not write to the Google Sheet." };
    }
  },
};
