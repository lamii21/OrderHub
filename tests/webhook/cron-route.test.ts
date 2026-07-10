import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "../mocks/supabase";
import { __resetRateLimitState } from "@/lib/rate-limit";

const { runSyncForShops } = vi.hoisted(() => ({ runSyncForShops: vi.fn() }));
const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));
vi.mock("@/lib/sync", () => ({ runSyncForShops }));

import { GET } from "@/app/api/cron/sync/route";

function makeRequest(authHeader: string | null, ip = "203.0.113.2") {
  return new NextRequest("http://localhost/api/cron/sync", {
    headers: {
      "x-forwarded-for": ip,
      ...(authHeader !== null && { authorization: authHeader }),
    },
  });
}

beforeEach(() => {
  runSyncForShops.mockReset();
  __resetRateLimitState();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("GET /api/cron/sync — authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await GET(makeRequest(null));
    expect(response.status).toBe(401);
  });

  it("rejects a header without the Bearer prefix", async () => {
    const response = await GET(makeRequest("test-cron-secret"));
    expect(response.status).toBe(401);
  });

  it("rejects the wrong bearer token", async () => {
    const response = await GET(makeRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("accepts the correct bearer token", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: [], error: null } } });
    holder.client = client;
    runSyncForShops.mockResolvedValue([]);

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(200);
  });
});

describe("GET /api/cron/sync — rate limiting", () => {
  it("returns 429 with Retry-After once a caller exceeds the limit, before the secret is even checked", async () => {
    const ip = "198.51.100.30";
    let lastResponse;
    for (let i = 0; i < 11; i++) {
      lastResponse = await GET(makeRequest("Bearer wrong-secret", ip));
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.headers.get("Retry-After")).toBeTruthy();
  });

  it("tracks separate callers independently", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: [], error: null } } });
    holder.client = client;
    runSyncForShops.mockResolvedValue([]);

    for (let i = 0; i < 10; i++) {
      await GET(makeRequest("Bearer test-cron-secret", "198.51.100.31"));
    }
    const response = await GET(makeRequest("Bearer test-cron-secret", "198.51.100.32"));

    expect(response.status).toBe(200);
  });
});

describe("GET /api/cron/sync — due-shop filtering", () => {
  it("only syncs shops that are both due and have auto_sync_enabled", async () => {
    const dueAndEnabled = {
      id: 1,
      store_url: "https://a.myshopify.com",
      api_key: "k1",
      sync_frequency: "daily",
      last_sync_attempt_at: null,
      auto_sync_enabled: true,
    };
    const dueButDisabled = {
      id: 2,
      store_url: "https://b.myshopify.com",
      api_key: "k2",
      sync_frequency: "daily",
      last_sync_attempt_at: null,
      auto_sync_enabled: false,
    };
    const notDue = {
      id: 3,
      store_url: "https://c.myshopify.com",
      api_key: "k3",
      sync_frequency: "daily",
      last_sync_attempt_at: new Date().toISOString(),
      auto_sync_enabled: true,
    };
    const { client } = createMockSupabase({
      responses: { shops: { data: [dueAndEnabled, dueButDisabled, notDue], error: null } },
    });
    holder.client = client;
    runSyncForShops.mockResolvedValue([{ shopId: 1, products: 0, orders: 0 }]);

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(runSyncForShops).toHaveBeenCalledWith([dueAndEnabled]);
    expect(json).toMatchObject({ success: true, checked: 3, due: 1, synced: 1, deferred: 0 });
  });

  it("filters shops to only those with both store_url and api_key set", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: [], error: null } },
    });
    holder.client = client;
    runSyncForShops.mockResolvedValue([]);

    await GET(makeRequest("Bearer test-cron-secret"));

    expect(builders.shops[0].not).toHaveBeenNthCalledWith(1, "store_url", "is", null);
    expect(builders.shops[0].not).toHaveBeenNthCalledWith(2, "api_key", "is", null);
  });

  it("returns 500 when the shops query fails", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(500);
    expect(runSyncForShops).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/sync — per-run cap (timeout budget)", () => {
  function dueShop(id: number, lastAttempt: string | null) {
    return {
      id,
      store_url: `https://shop-${id}.myshopify.com`,
      api_key: `k${id}`,
      sync_frequency: "daily",
      last_sync_attempt_at: lastAttempt,
      auto_sync_enabled: true,
    };
  }

  it("caps how many due shops one run syncs, reporting the rest as deferred", async () => {
    // 61 due shops, one more than MAX_SHOPS_PER_RUN (60).
    const shops = Array.from({ length: 61 }, (_, i) => dueShop(i + 1, null));
    const { client } = createMockSupabase({ responses: { shops: { data: shops, error: null } } });
    holder.client = client;
    runSyncForShops.mockImplementation(async (passed: { id: number }[]) =>
      passed.map((s) => ({ shopId: s.id, products: 0, orders: 0 }))
    );

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(runSyncForShops).toHaveBeenCalledTimes(1);
    const passedShops = runSyncForShops.mock.calls[0][0] as unknown[];
    expect(passedShops).toHaveLength(60);
    expect(json).toMatchObject({ due: 61, synced: 60, deferred: 1 });
  });

  it("processes the longest-waiting shops first when there's a backlog", async () => {
    const older = dueShop(1, "2026-01-01T00:00:00.000Z");
    const newer = dueShop(2, "2026-01-01T12:00:00.000Z");
    const neverAttempted = dueShop(3, null);
    const { client } = createMockSupabase({
      // Deliberately out of order in the "query result" to prove the route
      // sorts it, rather than trusting whatever order the database returned.
      responses: { shops: { data: [newer, older, neverAttempted], error: null } },
    });
    holder.client = client;
    runSyncForShops.mockResolvedValue([]);

    await GET(makeRequest("Bearer test-cron-secret"));

    const passedShops = runSyncForShops.mock.calls[0][0] as { id: number }[];
    expect(passedShops.map((s) => s.id)).toEqual([3, 1, 2]);
  });

  it("does not defer anything when the backlog fits within one run", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: [dueShop(1, null)], error: null } },
    });
    holder.client = client;
    runSyncForShops.mockResolvedValue([{ shopId: 1, products: 0, orders: 0 }]);

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(json.deferred).toBe(0);
  });
});
