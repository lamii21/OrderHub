import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "../mocks/supabase";
import { __resetRateLimitState } from "@/lib/rate-limit";

const { createOrUpdateShop, handleEvent } = vi.hoisted(() => ({
  createOrUpdateShop: vi.fn(),
  handleEvent: vi.fn(),
}));

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));
vi.mock("@/lib/shop", () => ({ createOrUpdateShop }));
vi.mock("@/lib/workflows/dispatch", () => ({ handleEvent }));

import { POST } from "@/app/api/orders/route";

const VALID_PAYLOAD = {
  shop_name: "Acme",
  platform: "Shopify",
  customer_name: "Amina",
  product: "T-Shirt",
  quantity: 1,
  price: 19.99,
};

function makeRequest(
  body: unknown,
  apiKey: string | null = "test-api-secret",
  ip = "203.0.113.1"
) {
  return new NextRequest("http://localhost/api/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(apiKey !== null && { "x-api-key": apiKey }),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  createOrUpdateShop.mockReset();
  handleEvent.mockReset();
  __resetRateLimitState();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/orders — authentication", () => {
  it("rejects a request with no x-api-key", async () => {
    const response = await POST(makeRequest(VALID_PAYLOAD, null));
    expect(response.status).toBe(401);
    expect(createOrUpdateShop).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong x-api-key", async () => {
    const response = await POST(makeRequest(VALID_PAYLOAD, "wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("accepts the correct x-api-key", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const { client } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: { data: { id: 1, shop_id: 1 }, error: null },
      },
    });
    holder.client = client;

    const response = await POST(makeRequest(VALID_PAYLOAD, "test-api-secret"));
    expect(response.status).not.toBe(401);
  });
});

describe("POST /api/orders — payload handling", () => {
  it("rejects invalid JSON with 400", async () => {
    const request = new NextRequest("http://localhost/api/orders", {
      method: "POST",
      headers: { "x-api-key": "test-api-secret", "content-type": "application/json" },
      body: "{not json",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("rejects a payload missing required fields with 400", async () => {
    const response = await POST(makeRequest({ shop_name: "Acme" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/customer_name/);
  });

  it("returns 500 when the shop can't be created/updated", async () => {
    createOrUpdateShop.mockRejectedValue(new Error("db down"));
    const response = await POST(makeRequest(VALID_PAYLOAD));
    expect(response.status).toBe(500);
  });

  it("returns 500 when the order upsert fails", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const { client } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: { data: null, error: { message: "constraint violation" } },
      },
    });
    holder.client = client;

    const response = await POST(makeRequest(VALID_PAYLOAD));
    expect(response.status).toBe(500);
    expect(handleEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/orders — order.created dispatch", () => {
  it("dispatches order.created for a payload with no order_id (always treated as new)", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const savedOrder = { id: 55, shop_id: 1 };
    const { client } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: { data: savedOrder, error: null },
      },
    });
    holder.client = client;

    const response = await POST(makeRequest(VALID_PAYLOAD));

    expect(response.status).toBe(200);
    expect(handleEvent).toHaveBeenCalledWith(1, "order.created", savedOrder);
  });

  it("dispatches order.created when order_id is new (the atomic insert wins, no conflict)", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const savedOrder = { id: 56, shop_id: 1, order_id: "SHOP-100" };
    const { client } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        // A single response: the ignoreDuplicates insert itself returns
        // the row directly when there's no conflict — no separate
        // existence check happens anymore.
        orders: { data: savedOrder, error: null },
      },
    });
    holder.client = client;

    const response = await POST(makeRequest({ ...VALID_PAYLOAD, order_id: "SHOP-100" }));

    expect(response.status).toBe(200);
    expect(handleEvent).toHaveBeenCalledWith(1, "order.created", savedOrder);
  });

  it("does NOT dispatch order.created for a duplicate delivery of an already-known order_id", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const savedOrder = { id: 56, shop_id: 1, order_id: "SHOP-100" };
    const { client } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: [
          // The ignoreDuplicates insert hits the existing row's unique
          // constraint and DOES NOTHING — no row returned.
          { data: null, error: null },
          // Falls through to the plain upsert, which updates the
          // existing row and returns it.
          { data: savedOrder, error: null },
        ],
      },
    });
    holder.client = client;

    const response = await POST(makeRequest({ ...VALID_PAYLOAD, order_id: "SHOP-100" }));

    expect(response.status).toBe(200);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  // Regression test for the Critical webhook race in the production
  // readiness report: two near-simultaneous deliveries of the same new
  // order used to both pass a "does this exist?" SELECT before either had
  // committed, so both fired order.created. There's no SELECT to race
  // anymore — this simulates the "lost" side of that race (the
  // ignoreDuplicates insert reports a conflict, exactly as it would if a
  // concurrent request's insert had just won) and asserts dispatch is
  // skipped, while the order's data is still correctly saved via the
  // fallback upsert.
  it("does not dispatch when the atomic insert reports a conflict (the losing side of a concurrent duplicate)", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const savedOrder = { id: 56, shop_id: 1, order_id: "SHOP-100" };
    const { client, builders } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: [
          { data: null, error: null }, // this request lost the race
          { data: savedOrder, error: null }, // falls through, still saves
        ],
      },
    });
    holder.client = client;

    const response = await POST(makeRequest({ ...VALID_PAYLOAD, order_id: "SHOP-100" }));
    const json = await response.json();

    expect(json.success).toBe(true);
    expect(handleEvent).not.toHaveBeenCalled();
    // Both attempts genuinely happened — this isn't silently dropping the
    // request, it's falling back to make sure the row is still written.
    expect(builders.orders).toHaveLength(2);
  });

  it("still returns 200 even when dispatch throws (automation is never a precondition for saving the order)", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    handleEvent.mockRejectedValue(new Error("workflow engine exploded"));
    const { client } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: { data: { id: 1, shop_id: 1 }, error: null },
      },
    });
    holder.client = client;

    const response = await POST(makeRequest(VALID_PAYLOAD));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  it("resolves and includes product_id when a matching product exists for the shop", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const { client, builders } = createMockSupabase({
      responses: {
        products: { data: { id: 77 }, error: null },
        orders: { data: { id: 1, shop_id: 1 }, error: null },
      },
    });
    holder.client = client;

    await POST(makeRequest(VALID_PAYLOAD));

    expect(builders.orders[0].upsert).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: 77 }),
      { onConflict: "shop_id,order_id", ignoreDuplicates: true }
    );
  });
});

describe("POST /api/orders — rate limiting", () => {
  it("returns 429 with a Retry-After header once a single caller exceeds the limit", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const { client } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: { data: { id: 1, shop_id: 1 }, error: null },
      },
    });
    holder.client = client;

    const ip = "198.51.100.9";
    let lastResponse;
    for (let i = 0; i < 121; i++) {
      lastResponse = await POST(makeRequest(VALID_PAYLOAD, "test-api-secret", ip));
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.headers.get("Retry-After")).toBeTruthy();
  });

  it("rate-limits before checking the API key — an unauthenticated flood is still capped", async () => {
    const ip = "198.51.100.10";
    let lastResponse;
    for (let i = 0; i < 121; i++) {
      lastResponse = await POST(makeRequest(VALID_PAYLOAD, "wrong-key", ip));
    }

    expect(lastResponse!.status).toBe(429);
  });

  it("tracks separate callers independently", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 1 });
    const { client } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: { data: { id: 1, shop_id: 1 }, error: null },
      },
    });
    holder.client = client;

    for (let i = 0; i < 120; i++) {
      await POST(makeRequest(VALID_PAYLOAD, "test-api-secret", "198.51.100.20"));
    }
    // A different caller's own request still goes through.
    const response = await POST(makeRequest(VALID_PAYLOAD, "test-api-secret", "198.51.100.21"));

    expect(response.status).toBe(200);
  });
});
