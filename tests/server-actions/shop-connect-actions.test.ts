import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";
import { __resetRateLimitState } from "@/lib/rate-limit";

const holder = vi.hoisted(() => ({
  // Two distinct clients, matching the app code's own split: the
  // RLS-scoped client (createSupabaseServerClient) for auth + reconnectShop's
  // update, and the service-role client (@/lib/supabase) for
  // getShopCredentials' shop lookup.
  userClient: undefined as unknown,
  serviceClient: undefined as unknown,
}));
const headersMock = vi.hoisted(() => ({ ip: "203.0.113.5" }));
const { getConnector, provisionShopSpreadsheetOrSkip, createOrUpdateShop, syncShopProducts, syncShopOrders, toPlatformCredentials } =
  vi.hoisted(() => ({
    getConnector: vi.fn(),
    provisionShopSpreadsheetOrSkip: vi.fn(),
    createOrUpdateShop: vi.fn(),
    syncShopProducts: vi.fn(),
    syncShopOrders: vi.fn(),
    toPlatformCredentials: vi.fn((shop: unknown) => shop),
  }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "x-forwarded-for" ? headersMock.ip : null),
  })),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.userClient),
}));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.serviceClient;
  },
}));
vi.mock("@/lib/platforms", () => ({ getConnector, SUPPORTED_PLATFORMS: ["Shopify", "WooCommerce", "YouCan"] }));
vi.mock("@/lib/google-sheets", () => ({ provisionShopSpreadsheetOrSkip }));
vi.mock("@/lib/shop", () => ({ createOrUpdateShop }));
vi.mock("@/lib/sync", () => ({ syncShopProducts, syncShopOrders, toPlatformCredentials }));

import { connectShop, testConnection, reconnectShop, syncProducts, syncOrders } from "@/app/shops/connect/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const ownedShop = {
  id: 1,
  user_id: "user-1",
  platform: "Shopify",
  sheet_id: "sheet-1",
  store_url: "https://acme.myshopify.com",
  api_key: "key-1",
  api_secret: null,
  last_synced_at: null,
};

function setUserClient(user: { id: string } | null = { id: "user-1" }) {
  const mock = createMockSupabase({ user });
  holder.userClient = mock.client;
  return mock;
}

function setServiceClient(shopData: unknown = ownedShop, error: unknown = null) {
  const mock = createMockSupabase({ responses: { shops: { data: shopData, error } } });
  holder.serviceClient = mock.client;
  return mock;
}

beforeEach(() => {
  getConnector.mockReset();
  provisionShopSpreadsheetOrSkip.mockReset();
  createOrUpdateShop.mockReset();
  syncShopProducts.mockReset();
  syncShopOrders.mockReset();
  __resetRateLimitState();
  headersMock.ip = "203.0.113.5";
  setUserClient();
  setServiceClient();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("connectShop", () => {
  const base = {
    name: "Acme",
    platform: "Shopify",
    store_url: "https://acme.myshopify.com",
    api_key: "key-1",
  };

  it("redirects with an error when a required field is missing", async () => {
    await expect(connectShop(formData({ ...base, api_key: "" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?error=.*all%20required/
    );
    expect(provisionShopSpreadsheetOrSkip).not.toHaveBeenCalled();
  });

  it("redirects with an error for an unsupported platform", async () => {
    await expect(connectShop(formData({ ...base, platform: "Magento" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?error=.*Unsupported%20platform/
    );
  });

  it("redirects to /login when there is no authenticated user", async () => {
    setUserClient(null);

    await expect(connectShop(formData(base))).rejects.toThrow("REDIRECT:/login");
    expect(provisionShopSpreadsheetOrSkip).not.toHaveBeenCalled();
  });

  it("provisions the spreadsheet, creates the shop with store credentials, and redirects with its id", async () => {
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: "sheet-1", name: "Acme" });
    createOrUpdateShop.mockResolvedValue({ id: 42 });
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(true) });

    await expect(connectShop(formData({ ...base, api_secret: "secret-1" }))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=42&connection_test=success"
    );

    expect(provisionShopSpreadsheetOrSkip).toHaveBeenCalledWith("user-1", "Acme", "Shopify");
    expect(createOrUpdateShop).toHaveBeenCalledWith({
      name: "Acme",
      platform: "Shopify",
      sheetId: "sheet-1",
      sheetName: "Acme",
      userId: "user-1",
      storeUrl: "https://acme.myshopify.com",
      apiKey: "key-1",
      apiSecret: "secret-1",
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"shop.connected"'));
  });

  // The UX gap this closes: previously a shop with a typo'd token still
  // showed as "connected" until the merchant separately clicked Test
  // Connection. Reuses the exact same connector.testConnection() call the
  // manual button already makes (verifyStoreConnection in
  // app/shops/connect/actions.ts) — no new validation logic, just run
  // automatically and surfaced immediately on the success page.
  it("automatically verifies the connection and redirects with connection_test=success when it works", async () => {
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: "sheet-1", name: "Acme" });
    createOrUpdateShop.mockResolvedValue({ id: 42 });
    const testConnectionMock = vi.fn().mockResolvedValue(true);
    getConnector.mockReturnValue({ testConnection: testConnectionMock });

    await expect(connectShop(formData({ ...base, api_secret: "secret-1" }))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=42&connection_test=success"
    );

    expect(getConnector).toHaveBeenCalledWith("Shopify");
    expect(testConnectionMock).toHaveBeenCalledWith({
      storeUrl: "https://acme.myshopify.com",
      apiKey: "key-1",
      apiSecret: "secret-1",
    });
  });

  it("redirects with connection_test=failed when the automatic verification fails, without blocking the save", async () => {
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: "sheet-1", name: "Acme" });
    createOrUpdateShop.mockResolvedValue({ id: 42 });
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(false) });

    await expect(connectShop(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=42&connection_test=failed"
    );

    expect(createOrUpdateShop).toHaveBeenCalled();
  });

  it("redirects with connection_test=failed (never throws) when the verification call itself errors", async () => {
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: "sheet-1", name: "Acme" });
    createOrUpdateShop.mockResolvedValue({ id: 42 });
    getConnector.mockReturnValue({
      testConnection: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    await expect(connectShop(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=42&connection_test=failed"
    );
  });

  // Same "trust the mocked result, not the skip-vs-provision branching
  // itself" scope as the equivalent test in shop-new-actions.test.ts —
  // provisionShopSpreadsheetOrSkip (lib/google-sheets.ts) is what actually
  // decides whether a missing/failed Google connection is swallowed; see
  // tests/unit/google-sheets.test.ts for that.
  it("still creates the shop when Google Sheets provisioning is skipped (no connected Google account)", async () => {
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: null, name: null });
    createOrUpdateShop.mockResolvedValue({ id: 42 });

    await expect(connectShop(formData(base))).rejects.toThrow("REDIRECT:/shops/connect?shop_id=42");

    expect(createOrUpdateShop).toHaveBeenCalledWith({
      name: "Acme",
      platform: "Shopify",
      sheetId: null,
      sheetName: null,
      userId: "user-1",
      storeUrl: "https://acme.myshopify.com",
      apiKey: "key-1",
    });
  });

  it("omits apiSecret entirely (not an empty string) when none was submitted", async () => {
    provisionShopSpreadsheetOrSkip.mockResolvedValue({ id: "sheet-1", name: "Acme" });
    createOrUpdateShop.mockResolvedValue({ id: 42 });

    await expect(connectShop(formData(base))).rejects.toThrow();

    const payload = createOrUpdateShop.mock.calls[0][0];
    expect(payload).not.toHaveProperty("apiSecret");
  });

  it("redirects with a generic error (never the raw error) when provisioning or saving fails", async () => {
    provisionShopSpreadsheetOrSkip.mockRejectedValue(new Error("The caller does not have permission"));

    await expect(connectShop(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?error=.*Could%20not%20create%20the%20shop/
    );
  });
});

// testConnection/syncProducts/syncOrders share checkExternalCallRateLimit()
// and getShopCredentials() — rate limiting and shop-authorization coverage
// is written once against testConnection and trusted to apply equally to
// the other two (see the "shares the same helper" note below each).
describe("testConnection", () => {
  it("allows a request under the limit and redirects with the connector's own result", async () => {
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(true) });

    await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=1&test=success"
    );
  });

  it("redirects with test=failed when the connector reports failure", async () => {
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(false) });

    await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=1&test=failed"
    );
  });

  it("redirects with an error once the rate limit is exceeded, without loading shop credentials", async () => {
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(true) });

    for (let i = 0; i < 20; i++) {
      await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow();
    }

    const service = holder.serviceClient as { from: ReturnType<typeof vi.fn> };
    service.from.mockClear();
    await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Too%20many%20requests/
    );
    expect(service.from).not.toHaveBeenCalled();
  });

  it("tracks separate callers independently", async () => {
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(true) });

    for (let i = 0; i < 20; i++) {
      await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow();
    }

    headersMock.ip = "198.51.100.9";
    await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=1&test=success"
    );
  });

  it("respects a custom redirect_to target", async () => {
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(true) });

    await expect(
      testConnection(formData({ shop_id: "1", redirect_to: "/shops/1" }))
    ).rejects.toThrow("REDIRECT:/shops/1?shop_id=1&test=success");
  });

  it("redirects to /login when there is no authenticated user (getShopCredentials denies)", async () => {
    setUserClient(null);

    await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Shop%20not%20found/
    );
    expect(getConnector).not.toHaveBeenCalled();
  });

  it("redirects with 'Shop not found' when the shop row doesn't exist", async () => {
    setServiceClient(null, null);

    await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Shop%20not%20found/
    );
  });

  it("redirects with 'Shop not found' when the shop belongs to a different user (ownership check)", async () => {
    setServiceClient({ ...ownedShop, user_id: "someone-else" });

    await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Shop%20not%20found/
    );
  });

  it("redirects with 'Shop not found' when the shop has no store_url or api_key (disconnected/Sheets-only)", async () => {
    setServiceClient({ ...ownedShop, store_url: null });

    await expect(testConnection(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Shop%20not%20found/
    );
  });
});

describe("reconnectShop", () => {
  const base = { shop_id: "1", platform: "Shopify", store_url: "https://acme.myshopify.com", api_key: "key-1" };

  it("redirects with an error when a required field is missing, without writing", async () => {
    await expect(reconnectShop(formData({ ...base, api_key: "" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?reconnect=1&error=.*required/
    );
    const user = holder.userClient as { from: ReturnType<typeof vi.fn> };
    expect(user.from).not.toHaveBeenCalled();
  });

  it("redirects with an error for an unsupported platform", async () => {
    await expect(reconnectShop(formData({ ...base, platform: "Magento" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?reconnect=1&error=.*Unsupported%20platform/
    );
  });

  it("refills the store credentials, stamps credentials_changed_at, and redirects into the shop_id success view", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const withShops = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.userClient = withShops.client;
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(true) });

    await expect(reconnectShop(formData({ ...base, api_secret: "secret-1" }))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=1&connection_test=success"
    );

    expect(withShops.builders.shops[0].update).toHaveBeenCalledWith({
      platform: "Shopify",
      store_url: "https://acme.myshopify.com",
      api_key: "key-1",
      api_secret: "secret-1",
      credentials_changed_at: "2026-01-01T00:00:00.000Z",
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"shop.reconnected"'));

    vi.useRealTimers();
  });

  it("also auto-verifies the connection on reconnect, same as a fresh connect", async () => {
    const withShops = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.userClient = withShops.client;
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValue(false) });

    await expect(reconnectShop(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=1&connection_test=failed"
    );
  });

  it("clears api_secret to null when none was submitted", async () => {
    const withShops = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.userClient = withShops.client;

    await expect(reconnectShop(formData(base))).rejects.toThrow();

    expect(withShops.builders.shops[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ api_secret: null })
    );
  });

  it("redirects with an error when the update fails", async () => {
    const withShops = createMockSupabase({
      responses: { shops: { data: null, error: { message: "db down" } } },
    });
    holder.userClient = withShops.client;

    await expect(reconnectShop(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?reconnect=1&error=.*Could%20not%20reconnect/
    );
  });
});

describe("syncProducts", () => {
  it("syncs and redirects with the imported count", async () => {
    syncShopProducts.mockResolvedValue({ success: true, count: 5 });

    await expect(syncProducts(formData({ shop_id: "1" }))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=1&products_synced=5"
    );
  });

  it("redirects with an error when the sync fails", async () => {
    syncShopProducts.mockResolvedValue({ success: false, count: 0 });

    await expect(syncProducts(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Could%20not%20sync%20products/
    );
  });

  it("shares the rate limit with testConnection/syncOrders (same helper, verified once above)", async () => {
    for (let i = 0; i < 20; i++) {
      await expect(syncProducts(formData({ shop_id: "1" }))).rejects.toThrow();
    }

    await expect(syncProducts(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Too%20many%20requests/
    );
  });

  it("redirects with 'Shop not found' when getShopCredentials denies access", async () => {
    setServiceClient(null, null);

    await expect(syncProducts(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Shop%20not%20found/
    );
    expect(syncShopProducts).not.toHaveBeenCalled();
  });
});

describe("syncOrders", () => {
  it("syncs and redirects with the imported count", async () => {
    syncShopOrders.mockResolvedValue({ success: true, count: 3 });

    await expect(syncOrders(formData({ shop_id: "1" }))).rejects.toThrow(
      "REDIRECT:/shops/connect?shop_id=1&orders_synced=3"
    );
  });

  it("redirects with an error when the sync fails", async () => {
    syncShopOrders.mockResolvedValue({ success: false, count: 0 });

    await expect(syncOrders(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Could%20not%20sync%20orders/
    );
  });

  it("redirects with 'Shop not found' when getShopCredentials denies access", async () => {
    setServiceClient(null, null);

    await expect(syncOrders(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/connect\?shop_id=1&error=.*Shop%20not%20found/
    );
    expect(syncShopOrders).not.toHaveBeenCalled();
  });
});
