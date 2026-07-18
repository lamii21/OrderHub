import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const { provisionShopSpreadsheetOrSkip, createOrUpdateShop } = vi.hoisted(() => ({
  provisionShopSpreadsheetOrSkip: vi.fn(),
  createOrUpdateShop: vi.fn(),
}));
const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));
vi.mock("@/lib/google-sheets", () => ({ provisionShopSpreadsheetOrSkip }));
vi.mock("@/lib/shop", () => ({ createOrUpdateShop }));

import { createShop } from "@/app/shops/new/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  provisionShopSpreadsheetOrSkip.mockReset();
  createOrUpdateShop.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createShop", () => {
  it("redirects with an error when the name is missing", async () => {
    await expect(createShop(formData({ name: "", platform: "Shopify" }))).rejects.toThrow(
      /REDIRECT:\/shops\/new\?error=.*required/
    );
    expect(provisionShopSpreadsheetOrSkip).not.toHaveBeenCalled();
  });

  it("redirects with an error when the platform is missing", async () => {
    await expect(createShop(formData({ name: "Acme", platform: "" }))).rejects.toThrow(
      /REDIRECT:\/shops\/new\?error=.*required/
    );
  });

  it("redirects to /login when there is no authenticated user", async () => {
    const { client } = createMockSupabase({ user: null });
    holder.client = client;

    await expect(createShop(formData({ name: "Acme", platform: "Shopify" }))).rejects.toThrow(
      "REDIRECT:/login"
    );
    expect(provisionShopSpreadsheetOrSkip).not.toHaveBeenCalled();
  });

  it("provisions the spreadsheet, saves the shop under the logged-in user, and redirects with the new sheet_id", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: "sheet-123", name: "Acme Store" });
    createOrUpdateShop.mockResolvedValue(undefined);

    await expect(
      createShop(formData({ name: "Acme Store", platform: "Shopify" }))
    ).rejects.toThrow("REDIRECT:/shops/new?sheet_id=sheet-123");

    expect(provisionShopSpreadsheetOrSkip).toHaveBeenCalledWith("user-1", "Acme Store", "Shopify");
    expect(createOrUpdateShop).toHaveBeenCalledWith({
      name: "Acme Store",
      platform: "Shopify",
      sheetId: "sheet-123",
      sheetName: "Acme Store",
      userId: "user-1",
    });
  });

  // provisionShopSpreadsheetOrSkip() (lib/google-sheets.ts) is what actually
  // decides whether a missing/failed Google connection is swallowed —
  // mocked here exactly the way it behaves after a failure: resolves with
  // nulls instead of rejecting. This test only proves createShop() does the
  // right thing with that result (still creates the shop, still succeeds),
  // not the skip branching itself (see tests/unit/google-sheets.test.ts).
  it("still creates the shop when Google Sheets provisioning is skipped (no connected Google account)", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: null, name: null });
    createOrUpdateShop.mockResolvedValue(undefined);

    await expect(
      createShop(formData({ name: "Acme Store", platform: "Shopify" }))
    ).rejects.toThrow("REDIRECT:/shops/new");

    expect(createOrUpdateShop).toHaveBeenCalledWith({
      name: "Acme Store",
      platform: "Shopify",
      sheetId: null,
      sheetName: null,
      userId: "user-1",
    });
  });

  it("redirects with a generic error when saving the shop fails after provisioning succeeded", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: "sheet-123", name: "Acme Store" });
    createOrUpdateShop.mockRejectedValue(new Error("duplicate key value violates unique constraint"));

    await expect(
      createShop(formData({ name: "Acme", platform: "Shopify" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/new\?error=.*Could%20not%20create%20the%20shop/);
  });
});
