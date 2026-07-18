import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const { provisionShopSpreadsheet } = vi.hoisted(() => ({ provisionShopSpreadsheet: vi.fn() }));
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

import {
  regenerateWebhookSecret,
  updateShopSettings,
  updateNotificationSettings,
  regenerateSpreadsheet,
} from "@/app/shops/[id]/settings/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  provisionShopSpreadsheet.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("updateShopSettings", () => {
  it("redirects with an error when the name is empty, without writing", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateShopSettings(formData({ shop_id: "1", name: "  ", sync_frequency: "daily" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/settings\?error=.*empty/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("redirects with an error on an invalid sync frequency, without writing", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateShopSettings(formData({ shop_id: "1", name: "Acme", sync_frequency: "biweekly" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/settings\?error=.*Invalid%20sync%20frequency/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("saves the settings, clearing store_url and defaulting currency/timezone when left blank, and redirects with saved=1", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: null, error: null } },
    });
    holder.client = client;

    await expect(
      updateShopSettings(
        formData({ shop_id: "1", name: "Acme", store_url: "", sync_frequency: "daily", currency: "", timezone: "" })
      )
    ).rejects.toThrow("REDIRECT:/shops/1/settings?saved=1");

    expect(builders.shops[0].update).toHaveBeenCalledWith({
      name: "Acme",
      store_url: null,
      sync_frequency: "daily",
      currency: "USD",
      timezone: "UTC",
    });
  });

  it("passes through a non-empty store_url/currency/timezone unchanged", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: null, error: null } },
    });
    holder.client = client;

    await expect(
      updateShopSettings(
        formData({
          shop_id: "1",
          name: "Acme",
          store_url: "https://acme.myshopify.com",
          sync_frequency: "hourly",
          currency: "EUR",
          timezone: "Europe/Paris",
        })
      )
    ).rejects.toThrow();

    expect(builders.shops[0].update).toHaveBeenCalledWith({
      name: "Acme",
      store_url: "https://acme.myshopify.com",
      sync_frequency: "hourly",
      currency: "EUR",
      timezone: "Europe/Paris",
    });
  });

  it("redirects with an error when the update fails", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(
      updateShopSettings(formData({ shop_id: "1", name: "Acme", sync_frequency: "daily" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/settings\?error=.*Could%20not%20save%20settings/);
  });
});

describe("updateNotificationSettings", () => {
  it('reads each checkbox as true only when present with value "on"', async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: null, error: null } },
    });
    holder.client = client;

    await expect(
      updateNotificationSettings(
        formData({ shop_id: "1", sync_products_enabled: "on", email_notifications_enabled: "on" })
      )
    ).rejects.toThrow("REDIRECT:/shops/1/settings?saved=1");

    expect(builders.shops[0].update).toHaveBeenCalledWith({
      sync_products_enabled: true,
      sync_orders_enabled: false,
      auto_sync_enabled: false,
      email_notifications_enabled: true,
    });
  });

  it("treats every checkbox as false when none are present in the form data", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: null, error: null } },
    });
    holder.client = client;

    await expect(updateNotificationSettings(formData({ shop_id: "1" }))).rejects.toThrow();

    expect(builders.shops[0].update).toHaveBeenCalledWith({
      sync_products_enabled: false,
      sync_orders_enabled: false,
      auto_sync_enabled: false,
      email_notifications_enabled: false,
    });
  });

  it("redirects with an error when the update fails", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(updateNotificationSettings(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/settings\?error=.*Could%20not%20save%20notification/
    );
  });
});

describe("regenerateSpreadsheet", () => {
  it("redirects to /login when there is no authenticated user, without querying the shop", async () => {
    const { client } = createMockSupabase({ user: null });
    holder.client = client;

    await expect(regenerateSpreadsheet(formData({ shop_id: "1" }))).rejects.toThrow("REDIRECT:/login");
    expect(client.from).not.toHaveBeenCalled();
    expect(provisionShopSpreadsheet).not.toHaveBeenCalled();
  });

  it("redirects with an error when the shop can't be found (RLS-scoped lookup)", async () => {
    const { client } = createMockSupabase({
      user: { id: "user-1" },
      responses: { shops: { data: null, error: null } },
    });
    holder.client = client;

    await expect(regenerateSpreadsheet(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/settings\?error=.*Shop%20not%20found/
    );
    expect(provisionShopSpreadsheet).not.toHaveBeenCalled();
  });

  it("provisions a new spreadsheet for the existing shop's name/platform under the logged-in user's Google account, and points the shop at it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { client, builders } = createMockSupabase({
      user: { id: "user-1" },
      responses: {
        shops: [
          { data: { name: "Acme", platform: "Shopify" }, error: null },
          { data: null, error: null },
        ],
      },
    });
    holder.client = client;
    provisionShopSpreadsheet.mockResolvedValue({ id: "sheet-999", name: "Acme" });

    await expect(regenerateSpreadsheet(formData({ shop_id: "1" }))).rejects.toThrow(
      "REDIRECT:/shops/1/settings?regenerated=1"
    );

    expect(provisionShopSpreadsheet).toHaveBeenCalledWith("user-1", "Acme", "Shopify");
    expect(builders.shops[1].update).toHaveBeenCalledWith({
      sheet_id: "sheet-999",
      sheet_name: "Acme",
      sheet_regenerated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"shop.spreadsheet_regenerated"'));

    vi.useRealTimers();
  });

  it("redirects with an error (never the raw error) when provisioning fails (e.g. no connected Google account)", async () => {
    const { client } = createMockSupabase({
      user: { id: "user-1" },
      responses: { shops: { data: { name: "Acme", platform: "Shopify" }, error: null } },
    });
    holder.client = client;
    provisionShopSpreadsheet.mockRejectedValue(new Error("No connected Google account for this user"));

    await expect(regenerateSpreadsheet(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/settings\?error=.*Connect%20your%20Google%20account/
    );
  });

  it("redirects with an error when pointing the shop at the new sheet fails", async () => {
    const { client } = createMockSupabase({
      user: { id: "user-1" },
      responses: {
        shops: [
          { data: { name: "Acme", platform: "Shopify" }, error: null },
          { data: null, error: { message: "db down" } },
        ],
      },
    });
    holder.client = client;
    provisionShopSpreadsheet.mockResolvedValue({ id: "sheet-999", name: "Acme" });

    await expect(regenerateSpreadsheet(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/settings\?error=.*Connect%20your%20Google%20account/
    );
  });
});

describe("regenerateWebhookSecret", () => {
  it("writes a new, non-empty webhook_secret for the shop and redirects with secret_regenerated=1", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: null, error: null } },
    });
    holder.client = client;

    await expect(regenerateWebhookSecret(formData({ shop_id: "1" }))).rejects.toThrow(
      "REDIRECT:/shops/1/settings?secret_regenerated=1"
    );

    expect(builders.shops[0].eq).toHaveBeenCalledWith("id", "1");
    const payload = builders.shops[0].update.mock.calls[0][0] as { webhook_secret: string };
    expect(typeof payload.webhook_secret).toBe("string");
    expect(payload.webhook_secret.length).toBeGreaterThanOrEqual(32);
  });

  it("generates a different secret on every call (not a fixed/predictable value)", async () => {
    const first = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = first.client;
    await expect(regenerateWebhookSecret(formData({ shop_id: "1" }))).rejects.toThrow();
    const firstSecret = (first.builders.shops[0].update.mock.calls[0][0] as { webhook_secret: string })
      .webhook_secret;

    const second = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = second.client;
    await expect(regenerateWebhookSecret(formData({ shop_id: "1" }))).rejects.toThrow();
    const secondSecret = (second.builders.shops[0].update.mock.calls[0][0] as { webhook_secret: string })
      .webhook_secret;

    expect(firstSecret).not.toBe(secondSecret);
  });

  it("redirects with an error when the update fails, without leaking the raw error", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(regenerateWebhookSecret(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/settings\?error=.*Could%20not%20regenerate/
    );
  });
});
