import { describe, it, expect, vi, beforeEach } from "vitest";

const { driveFilesCopy, drivePermissionsCreate, sheetsValuesUpdate, sheetsValuesAppend } = vi.hoisted(() => ({
  driveFilesCopy: vi.fn(),
  drivePermissionsCreate: vi.fn(),
  sheetsValuesUpdate: vi.fn(),
  sheetsValuesAppend: vi.fn(),
}));

// Mocks the googleapis package itself, one level below lib/google-sheets.ts
// — unlike every module-level test elsewhere (e.g. tests/modules/google-
// sheets.test.ts), which mocks this whole file at its own boundary, this is
// the one place lib/google-sheets.ts's own logic (the exact requestBody
// shape sent to Drive/Sheets, response parsing) actually gets exercised.
vi.mock("googleapis", () => ({
  google: {
    // Must be a real constructor (called with `new`), not an arrow
    // function — a plain `function` expression works with both `new` and
    // vi.fn()'s call-tracking.
    auth: { JWT: vi.fn(function JWT() {}) },
    drive: vi.fn(() => ({
      files: { copy: driveFilesCopy },
      permissions: { create: drivePermissionsCreate },
    })),
    sheets: vi.fn(() => ({
      spreadsheets: { values: { update: sheetsValuesUpdate, append: sheetsValuesAppend } },
    })),
  },
}));

import { provisionShopSpreadsheet, appendOrderRows, appendRowToSheet } from "@/lib/google-sheets";

beforeEach(() => {
  driveFilesCopy.mockReset();
  drivePermissionsCreate.mockReset();
  sheetsValuesUpdate.mockReset();
  sheetsValuesAppend.mockReset();
});

describe("provisionShopSpreadsheet", () => {
  it("copies the template, fills the Config tab, shares with the owner, and returns the new sheet's id/name", async () => {
    driveFilesCopy.mockResolvedValue({ data: { id: "sheet-123", name: "Acme Store" } });
    sheetsValuesUpdate.mockResolvedValue({});
    drivePermissionsCreate.mockResolvedValue({});

    const result = await provisionShopSpreadsheet("Acme Store", "Shopify", "owner@example.com");

    expect(driveFilesCopy).toHaveBeenCalledWith({
      fileId: "test-template-id",
      requestBody: { name: "Acme Store" },
    });
    expect(sheetsValuesUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-123",
      range: "Config!B1:B2",
      valueInputOption: "RAW",
      requestBody: { values: [["Acme Store"], ["Shopify"]] },
    });
    expect(drivePermissionsCreate).toHaveBeenCalledWith({
      fileId: "sheet-123",
      sendNotificationEmail: true,
      requestBody: { role: "writer", type: "user", emailAddress: "owner@example.com" },
    });
    expect(result).toEqual({ id: "sheet-123", name: "Acme Store" });
  });

  it("propagates a rejection from the Drive API (e.g. template not shared with the service account)", async () => {
    driveFilesCopy.mockRejectedValue(new Error("The caller does not have permission"));

    await expect(provisionShopSpreadsheet("Acme", "Shopify", "owner@example.com")).rejects.toThrow(
      "The caller does not have permission"
    );
    expect(sheetsValuesUpdate).not.toHaveBeenCalled();
    expect(drivePermissionsCreate).not.toHaveBeenCalled();
  });
});

describe("appendOrderRows", () => {
  it("appends rows to the Orders tab in the shop's provisioned spreadsheet", async () => {
    sheetsValuesAppend.mockResolvedValue({});
    const rows = [["ORD-1", "Amina", "0600000000"]];

    await appendOrderRows("sheet-123", rows);

    expect(sheetsValuesAppend).toHaveBeenCalledWith({
      spreadsheetId: "sheet-123",
      range: "Orders!A:G",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
  });
});

describe("appendRowToSheet", () => {
  it("appends one row to the given spreadsheet/tab and returns the updated range", async () => {
    sheetsValuesAppend.mockResolvedValue({ data: { updates: { updatedRange: "Tracking!A5:H5" } } });

    const result = await appendRowToSheet("sheet-abc", "Tracking", ["a", "b", 1]);

    expect(sheetsValuesAppend).toHaveBeenCalledWith({
      spreadsheetId: "sheet-abc",
      range: "Tracking!A:Z",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [["a", "b", 1]] },
    });
    expect(result).toEqual({ updatedRange: "Tracking!A5:H5" });
  });

  it("returns undefined updatedRange when the API response doesn't include one", async () => {
    sheetsValuesAppend.mockResolvedValue({ data: {} });

    const result = await appendRowToSheet("sheet-abc", "Tracking", ["a"]);

    expect(result).toEqual({ updatedRange: undefined });
  });
});
