import { describe, it, expect, vi, beforeEach } from "vitest";

const { appendRowToSheet } = vi.hoisted(() => ({ appendRowToSheet: vi.fn() }));
vi.mock("@/lib/google-sheets", () => ({ appendRowToSheet }));

import { googleSheetsModule } from "@/lib/automation-modules/google-sheets";
import type { Order } from "@/types/order";

const order = {
  id: 1,
  created_at: "2026-01-01T00:00:00Z",
  customer_name: "Amina",
  customer_phone: "0600000000",
  customer_city: "Rabat",
  product: "T-Shirt",
  quantity: 2,
  price: 19.99,
  status: "pending",
} as Order;

beforeEach(() => {
  appendRowToSheet.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("googleSheetsModule.validateConfig", () => {
  it("rejects a missing spreadsheetId", () => {
    expect(googleSheetsModule.validateConfig!({ sheetName: "Sheet1" })).toMatch(/spreadsheet ID/);
  });

  it("rejects a missing sheetName", () => {
    expect(googleSheetsModule.validateConfig!({ spreadsheetId: "abc" })).toMatch(/sheet .tab. name/);
  });

  it("accepts both fields present", () => {
    expect(
      googleSheetsModule.validateConfig!({ spreadsheetId: "abc", sheetName: "Sheet1" })
    ).toBeNull();
  });
});

describe("googleSheetsModule.run", () => {
  it("appends a row built from the order's fields, reusing lib/google-sheets.ts", async () => {
    appendRowToSheet.mockResolvedValue({ updatedRange: "Sheet1!A5:H5" });

    const result = await googleSheetsModule.run(
      order,
      { spreadsheetId: "sheet-abc", sheetName: "Tracking" },
      {}
    );

    expect(appendRowToSheet).toHaveBeenCalledWith("sheet-abc", "Tracking", [
      "2026-01-01T00:00:00Z",
      "Amina",
      "0600000000",
      "Rabat",
      "T-Shirt",
      2,
      19.99,
      "pending",
    ]);
    expect(result).toEqual({
      success: true,
      message: "Row appended to the Google Sheet.",
      data: { updatedRange: "Sheet1!A5:H5" },
    });
  });

  it("reports a structured failure without throwing when the Google API call rejects", async () => {
    appendRowToSheet.mockRejectedValue(new Error("The caller does not have permission"));

    const result = await googleSheetsModule.run(
      order,
      { spreadsheetId: "sheet-abc", sheetName: "Tracking" },
      {}
    );

    expect(result).toEqual({ success: false, message: "Could not write to the Google Sheet." });
  });
});
