import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { getModuleCredentials, invalidateModuleCredentialsCache } from "@/lib/automation-modules/credentials";

beforeEach(() => {
  // The cache is module-scope state shared across every test in this file
  // (and every other module that calls getModuleCredentials) — without
  // this, a later test's lookup for the same (shopId, moduleName) would
  // silently return an earlier test's cached value instead of hitting the
  // mock client at all.
  invalidateModuleCredentialsCache();
});

describe("getModuleCredentials", () => {
  it("looks up by (shop_id, module_name) and returns the stored credentials", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        module_credentials: {
          data: { credentials: { accessToken: "tok", phoneNumberId: "id-1" } },
          error: null,
        },
      },
    });
    holder.client = client;

    const result = await getModuleCredentials(7, "whatsapp");

    expect(result).toEqual({ accessToken: "tok", phoneNumberId: "id-1" });
    expect(builders.module_credentials[0].eq).toHaveBeenNthCalledWith(1, "shop_id", 7);
    expect(builders.module_credentials[0].eq).toHaveBeenNthCalledWith(2, "module_name", "whatsapp");
  });

  it("returns null when nothing is configured for that shop/module", async () => {
    const { client } = createMockSupabase({
      responses: { module_credentials: { data: null, error: null } },
    });
    holder.client = client;

    await expect(getModuleCredentials(7, "email")).resolves.toBeNull();
  });

  it("returns null (never throws) on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { module_credentials: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(getModuleCredentials(7, "email")).resolves.toBeNull();
  });

  it("serves a second lookup for the same (shop, module) from cache, without a second query", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        module_credentials: { data: { credentials: { apiKey: "k1" } }, error: null },
      },
    });
    holder.client = client;

    await getModuleCredentials(7, "delivery");
    await getModuleCredentials(7, "delivery");

    expect(client.from).toHaveBeenCalledTimes(1);
    expect(builders.module_credentials).toHaveLength(1);
  });

  it("keys the cache independently per (shop, module) — no cross-contamination", async () => {
    const { client } = createMockSupabase({
      responses: {
        module_credentials: [
          { data: { credentials: { apiKey: "shop-7-key" } }, error: null },
          { data: { credentials: { apiKey: "shop-8-key" } }, error: null },
        ],
      },
    });
    holder.client = client;

    const shop7 = await getModuleCredentials(7, "email");
    const shop8 = await getModuleCredentials(8, "email");

    expect(shop7).toEqual({ apiKey: "shop-7-key" });
    expect(shop8).toEqual({ apiKey: "shop-8-key" });
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("never caches a query error — the next call retries immediately", async () => {
    const { client } = createMockSupabase({
      responses: {
        module_credentials: [
          { data: null, error: { message: "db down" } },
          { data: { credentials: { apiKey: "recovered" } }, error: null },
        ],
      },
    });
    holder.client = client;

    const first = await getModuleCredentials(7, "email");
    const second = await getModuleCredentials(7, "email");

    expect(first).toBeNull();
    expect(second).toEqual({ apiKey: "recovered" });
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("invalidateModuleCredentialsCache(shopId) clears every module cached for that shop, without touching other shops", async () => {
    const { client } = createMockSupabase({
      responses: {
        module_credentials: [
          { data: { credentials: { apiKey: "shop7-whatsapp-old" } }, error: null },
          { data: { credentials: { apiKey: "shop7-email-old" } }, error: null },
          { data: { credentials: { apiKey: "shop8-email" } }, error: null },
          { data: { credentials: { apiKey: "shop7-whatsapp-new" } }, error: null },
          { data: { credentials: { apiKey: "shop8-email" } }, error: null },
        ],
      },
    });
    holder.client = client;

    await getModuleCredentials(7, "whatsapp");
    await getModuleCredentials(7, "email");
    await getModuleCredentials(8, "email");

    invalidateModuleCredentialsCache(7);

    const shop7WhatsappAfter = await getModuleCredentials(7, "whatsapp");
    const shop8EmailAfter = await getModuleCredentials(8, "email");

    expect(shop7WhatsappAfter).toEqual({ apiKey: "shop7-whatsapp-new" });
    // Shop 8's entry survived the shop-7-scoped invalidation, so this is
    // served from cache — no 5th query.
    expect(shop8EmailAfter).toEqual({ apiKey: "shop8-email" });
    expect(client.from).toHaveBeenCalledTimes(4);
  });

  it("invalidateModuleCredentialsCache() forces the next lookup to hit the database again", async () => {
    const { client } = createMockSupabase({
      responses: {
        module_credentials: [
          { data: { credentials: { apiKey: "old" } }, error: null },
          { data: { credentials: { apiKey: "new" } }, error: null },
        ],
      },
    });
    holder.client = client;

    const before = await getModuleCredentials(7, "whatsapp");
    invalidateModuleCredentialsCache(7, "whatsapp");
    const after = await getModuleCredentials(7, "whatsapp");

    expect(before).toEqual({ apiKey: "old" });
    expect(after).toEqual({ apiKey: "new" });
    expect(client.from).toHaveBeenCalledTimes(2);
  });
});
