import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "../mocks/supabase";
import { __resetRateLimitState } from "@/lib/rate-limit";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { GET } from "@/app/api/health/route";

const ORIGINAL_ENV = { ...process.env };

function makeRequest(ip = "203.0.113.5") {
  return new NextRequest("http://localhost/api/health", {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env = { ...ORIGINAL_ENV };
  __resetRateLimitState();
});

describe("GET /api/health", () => {
  it("returns 200 ok when the database answers and every core env var is set", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: [], error: null, count: 3 } },
    });
    holder.client = client;

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("ok");
    expect(json.checks.database).toBe("ok");
    expect(json.checks.environment).toBe("ok");
    expect(json.shopCount).toBe(3);
  });

  it("returns 503 when the database query fails", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: null, error: { message: "connection refused" } } },
    });
    holder.client = client;

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.status).toBe("degraded");
    expect(json.checks.database).toBe("error");
    expect(json.shopCount).toBeNull();
  });

  it("returns 503 when a core environment variable is missing, even if the database is fine", async () => {
    delete process.env.CRON_SECRET;
    const { client } = createMockSupabase({
      responses: { shops: { data: [], error: null, count: 0 } },
    });
    holder.client = client;

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.checks.environment).toBe("missing_required_vars");
  });

  it("always includes a timestamp", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: [], error: null, count: 0 } },
    });
    holder.client = client;

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(typeof json.timestamp).toBe("string");
    expect(new Date(json.timestamp).toString()).not.toBe("Invalid Date");
  });
});

describe("GET /api/health — rate limiting", () => {
  it("returns 429 with Retry-After once a single caller exceeds the limit, without touching the database", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: [], error: null, count: 0 } },
    });
    holder.client = client;

    const ip = "198.51.100.40";
    let lastResponse;
    for (let i = 0; i < 31; i++) {
      lastResponse = await GET(makeRequest(ip));
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.headers.get("Retry-After")).toBeTruthy();
    expect(builders.shops).toHaveLength(30);
  });

  it("tracks separate callers independently", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: [], error: null, count: 0 } },
    });
    holder.client = client;

    for (let i = 0; i < 30; i++) {
      await GET(makeRequest("198.51.100.41"));
    }
    const response = await GET(makeRequest("198.51.100.42"));

    expect(response.status).toBe(200);
  });
});
