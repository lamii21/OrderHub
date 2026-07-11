import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const { provisionShopSpreadsheet, createOrUpdateShop } = vi.hoisted(() => ({
  provisionShopSpreadsheet: vi.fn(),
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
vi.mock("@/lib/google-sheets", () => ({ provisionShopSpreadsheet }));
vi.mock("@/lib/shop", () => ({ createOrUpdateShop }));

import { createShop } from "@/app/shops/new/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  provisionShopSpreadsheet.mockReset();
  createOrUpdateShop.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createShop", () => {
  it("redirects with an error when the name is missing", async () => {
    await expect(
      createShop(formData({ name: "", platform: "Shopify", owner_email: "a@b.com" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/new\?error=.*required/);
    expect(provisionShopSpreadsheet).not.toHaveBeenCalled();
  });

  it("redirects with an error when the platform is missing", async () => {
    await expect(
      createShop(formData({ name: "Acme", platform: "", owner_email: "a@b.com" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/new\?error=.*required/);
  });

  it("redirects with an error when the owner email is missing", async () => {
    await expect(
      createShop(formData({ name: "Acme", platform: "Shopify", owner_email: "" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/new\?error=.*required/);
  });

  it("redirects with an error on an invalid owner email", async () => {
    await expect(
      createShop(formData({ name: "Acme", platform: "Shopify", owner_email: "not-an-email" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/new\?error=.*valid%20Google%20account/);
    expect(provisionShopSpreadsheet).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is no authenticated user", async () => {
    const { client } = createMockSupabase({ user: null });
    holder.client = client;

    await expect(
      createShop(formData({ name: "Acme", platform: "Shopify", owner_email: "a@b.com" }))
    ).rejects.toThrow("REDIRECT:/login");
    expect(provisionShopSpreadsheet).not.toHaveBeenCalled();
  });

  it("provisions the spreadsheet, saves the shop under the logged-in user, and redirects with the new sheet_id", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;
    provisionShopSpreadsheet.mockResolvedValue({ id: "sheet-123", name: "Acme Store" });
    createOrUpdateShop.mockResolvedValue(undefined);

    await expect(
      createShop(formData({ name: "Acme Store", platform: "Shopify", owner_email: "owner@example.com" }))
    ).rejects.toThrow("REDIRECT:/shops/new?sheet_id=sheet-123");

    expect(provisionShopSpreadsheet).toHaveBeenCalledWith("Acme Store", "Shopify", "owner@example.com");
    expect(createOrUpdateShop).toHaveBeenCalledWith({
      name: "Acme Store",
      platform: "Shopify",
      sheetId: "sheet-123",
      sheetName: "Acme Store",
      userId: "user-1",
    });
  });

  it("redirects with a generic error when provisioning the spreadsheet fails, without saving the shop", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;
    provisionShopSpreadsheet.mockRejectedValue(new Error("The caller does not have permission"));

    await expect(
      createShop(formData({ name: "Acme", platform: "Shopify", owner_email: "owner@example.com" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/new\?error=.*Could%20not%20create%20the%20shop/);

    expect(createOrUpdateShop).not.toHaveBeenCalled();
  });

  it("redirects with a generic error (never the raw error) when saving the shop fails after provisioning succeeded", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;
    provisionShopSpreadsheet.mockResolvedValue({ id: "sheet-123", name: "Acme Store" });
    createOrUpdateShop.mockRejectedValue(new Error("duplicate key value violates unique constraint"));

    await expect(
      createShop(formData({ name: "Acme", platform: "Shopify", owner_email: "owner@example.com" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/new\?error=.*Could%20not%20create%20the%20shop/);
  });
});
