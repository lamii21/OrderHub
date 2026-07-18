import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { driveFilesCopy, drivePermissionsCreate, sheetsCreate, sheetsValuesUpdate, sheetsValuesAppend } =
  vi.hoisted(() => ({
    driveFilesCopy: vi.fn(),
    drivePermissionsCreate: vi.fn(),
    sheetsCreate: vi.fn(),
    sheetsValuesUpdate: vi.fn(),
    sheetsValuesAppend: vi.fn(),
  }));

// Mocks the googleapis package itself, one level below lib/google-sheets.ts
// — this is the one place lib/google-sheets.ts's own logic (the exact
// requestBody shape sent to Drive/Sheets, response parsing) actually gets
// exercised. Credential-building (which account, whether one exists) is a
// separate concern mocked below via @/lib/google-oauth.
vi.mock("googleapis", () => ({
  google: {
    drive: vi.fn(() => ({
      files: { copy: driveFilesCopy },
      permissions: { create: drivePermissionsCreate },
    })),
    sheets: vi.fn(() => ({
      spreadsheets: {
        create: sheetsCreate,
        values: { update: sheetsValuesUpdate, append: sheetsValuesAppend },
      },
    })),
  },
}));

const { buildUserOAuth2Client, getUserIdForShop } = vi.hoisted(() => ({
  buildUserOAuth2Client: vi.fn(),
  getUserIdForShop: vi.fn(),
}));
vi.mock("@/lib/google-oauth", () => ({ buildUserOAuth2Client, getUserIdForShop }));

import {
  provisionShopSpreadsheet,
  provisionShopSpreadsheetOrSkip,
  appendOrderRows,
  appendRowToSheet,
} from "@/lib/google-sheets";
import { logger } from "@/lib/logger";

const FAKE_AUTH_CLIENT = { fake: "oauth2-client" };

beforeEach(() => {
  driveFilesCopy.mockReset();
  drivePermissionsCreate.mockReset();
  sheetsCreate.mockReset();
  sheetsValuesUpdate.mockReset();
  sheetsValuesAppend.mockReset();
  buildUserOAuth2Client.mockReset();
  getUserIdForShop.mockReset();
  buildUserOAuth2Client.mockResolvedValue(FAKE_AUTH_CLIENT);
  delete process.env.GOOGLE_SHEETS_TEMPLATE_ID;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provisionShopSpreadsheet", () => {
  it("throws when the user has no connected Google account", async () => {
    buildUserOAuth2Client.mockResolvedValue(null);

    await expect(provisionShopSpreadsheet("user-1", "Acme", "Shopify")).rejects.toThrow(
      "No connected Google account for this user"
    );
    expect(driveFilesCopy).not.toHaveBeenCalled();
  });

  describe("when GOOGLE_SHEETS_TEMPLATE_ID is set", () => {
    beforeEach(() => {
      process.env.GOOGLE_SHEETS_TEMPLATE_ID = "test-template-id";
    });

    it("copies the template, fills the Config tab, and returns the new sheet's id/name", async () => {
      driveFilesCopy.mockResolvedValue({ data: { id: "sheet-123", name: "Acme Store" } });
      sheetsValuesUpdate.mockResolvedValue({});

      const result = await provisionShopSpreadsheet("user-1", "Acme Store", "Shopify");

      expect(buildUserOAuth2Client).toHaveBeenCalledWith("user-1");
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
      expect(sheetsCreate).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "sheet-123", name: "Acme Store" });
    });

    it("no longer shares the copy with anyone — it's already in the connected user's own Drive", async () => {
      driveFilesCopy.mockResolvedValue({ data: { id: "sheet-123", name: "Acme Store" } });
      sheetsValuesUpdate.mockResolvedValue({});

      await provisionShopSpreadsheet("user-1", "Acme Store", "Shopify");

      expect(drivePermissionsCreate).not.toHaveBeenCalled();
    });

    it("propagates a rejection from the Drive API (e.g. template not shared with the connected account)", async () => {
      driveFilesCopy.mockRejectedValue(new Error("The caller does not have permission"));

      await expect(provisionShopSpreadsheet("user-1", "Acme", "Shopify")).rejects.toThrow(
        "The caller does not have permission"
      );
      expect(sheetsValuesUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when GOOGLE_SHEETS_TEMPLATE_ID is unset", () => {
    it("creates a blank spreadsheet from scratch with Orders/Config tabs and the exact header row", async () => {
      sheetsCreate.mockResolvedValue({
        data: { spreadsheetId: "sheet-456", properties: { title: "Acme Store" } },
      });
      sheetsValuesUpdate.mockResolvedValue({});

      const result = await provisionShopSpreadsheet("user-1", "Acme Store", "Shopify");

      expect(driveFilesCopy).not.toHaveBeenCalled();
      expect(sheetsCreate).toHaveBeenCalledWith({
        requestBody: {
          properties: { title: "Acme Store" },
          sheets: [{ properties: { title: "Orders" } }, { properties: { title: "Config" } }],
        },
      });
      expect(sheetsValuesUpdate).toHaveBeenCalledWith({
        spreadsheetId: "sheet-456",
        range: "Orders!A1:H1",
        valueInputOption: "RAW",
        requestBody: {
          values: [
            [
              "Customer Name",
              "Customer Phone",
              "Customer City",
              "Customer Address",
              "Product",
              "Quantity",
              "Price",
              "Synced",
            ],
          ],
        },
      });
      expect(sheetsValuesUpdate).toHaveBeenCalledWith({
        spreadsheetId: "sheet-456",
        range: "Config!B1:B2",
        valueInputOption: "RAW",
        requestBody: { values: [["Acme Store"], ["Shopify"]] },
      });
      expect(result).toEqual({ id: "sheet-456", name: "Acme Store" });
    });
  });
});

describe("provisionShopSpreadsheetOrSkip", () => {
  it("skips and resolves with nulls when the user has no connected Google account", async () => {
    buildUserOAuth2Client.mockResolvedValue(null);
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const result = await provisionShopSpreadsheetOrSkip("user-1", "Acme", "Shopify");

    expect(result).toEqual({ id: null, name: null });
    expect(warnSpy).toHaveBeenCalledWith("google_sheets.provisioning_skipped", { userId: "user-1" });
  });

  it("skips and resolves with nulls when the Google API call fails (connected account, unrelated error)", async () => {
    process.env.GOOGLE_SHEETS_TEMPLATE_ID = "test-template-id";
    driveFilesCopy.mockRejectedValue(new Error("The caller does not have permission"));
    vi.spyOn(logger, "warn").mockImplementation(() => {});

    const result = await provisionShopSpreadsheetOrSkip("user-1", "Acme", "Shopify");

    expect(result).toEqual({ id: null, name: null });
  });

  it("provisions normally when the account is connected and the call succeeds", async () => {
    process.env.GOOGLE_SHEETS_TEMPLATE_ID = "test-template-id";
    driveFilesCopy.mockResolvedValue({ data: { id: "sheet-123", name: "Acme Store" } });
    sheetsValuesUpdate.mockResolvedValue({});
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const result = await provisionShopSpreadsheetOrSkip("user-1", "Acme Store", "Shopify");

    expect(result).toEqual({ id: "sheet-123", name: "Acme Store" });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("appendOrderRows", () => {
  it("resolves the shop's owner and appends rows to the Orders tab", async () => {
    getUserIdForShop.mockResolvedValue("user-1");
    sheetsValuesAppend.mockResolvedValue({});
    const rows = [["ORD-1", "Amina", "0600000000"]];

    await appendOrderRows(7, "sheet-123", rows);

    expect(getUserIdForShop).toHaveBeenCalledWith(7);
    expect(buildUserOAuth2Client).toHaveBeenCalledWith("user-1");
    expect(sheetsValuesAppend).toHaveBeenCalledWith({
      spreadsheetId: "sheet-123",
      range: "Orders!A:G",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
  });

  it("throws when the shop has no owner", async () => {
    getUserIdForShop.mockResolvedValue(null);

    await expect(appendOrderRows(999, "sheet-123", [])).rejects.toThrow("No owner found for shop 999");
    expect(sheetsValuesAppend).not.toHaveBeenCalled();
  });
});

describe("appendRowToSheet", () => {
  it("resolves the shop's owner, appends one row, and returns the updated range", async () => {
    getUserIdForShop.mockResolvedValue("user-1");
    sheetsValuesAppend.mockResolvedValue({ data: { updates: { updatedRange: "Tracking!A5:H5" } } });

    const result = await appendRowToSheet(7, "sheet-abc", "Tracking", ["a", "b", 1]);

    expect(getUserIdForShop).toHaveBeenCalledWith(7);
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
    getUserIdForShop.mockResolvedValue("user-1");
    sheetsValuesAppend.mockResolvedValue({ data: {} });

    const result = await appendRowToSheet(7, "sheet-abc", "Tracking", ["a"]);

    expect(result).toEqual({ updatedRange: undefined });
  });
});
