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

import { GET } from "@/app/api/metrics/route";

function makeRequest(authHeader: string | null, ip = "203.0.113.9") {
  return new NextRequest("http://localhost/api/metrics", {
    headers: {
      "x-forwarded-for": ip,
      ...(authHeader !== null && { authorization: authHeader }),
    },
  });
}

function okClient(overrides: Record<string, { data: unknown; error: unknown; count?: number }> = {}) {
  return createMockSupabase({
    responses: {
      shops: { data: null, error: null, count: 5 },
      orders: [
        { data: null, error: null, count: 120 },
        { data: null, error: null, count: 8 },
      ],
      sync_history: { data: [{ status: "success" }, { status: "success" }, { status: "failed" }], error: null },
      workflow_executions: { data: [{ status: "success" }], error: null },
      ...overrides,
    },
  });
}

beforeEach(() => {
  __resetRateLimitState();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/metrics — authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await GET(makeRequest(null));
    expect(response.status).toBe(401);
  });

  it("rejects the wrong bearer token", async () => {
    const response = await GET(makeRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("accepts the correct bearer token", async () => {
    const { client } = okClient();
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(200);
  });
});

describe("GET /api/metrics — rate limiting", () => {
  it("returns 429 with Retry-After once a caller exceeds the limit, before the secret is even checked", async () => {
    const ip = "198.51.100.60";
    let lastResponse;
    for (let i = 0; i < 31; i++) {
      lastResponse = await GET(makeRequest("Bearer wrong-secret", ip));
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("GET /api/metrics — payload shape", () => {
  it("returns global counts and 24h success rates", async () => {
    const { client } = okClient();
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.shops).toEqual({ total: 5 });
    expect(json.orders).toEqual({ total: 120, last24h: 8 });
    expect(json.sync).toEqual({ attempts24h: 3, successRate24h: 66.7 });
    expect(json.workflowExecutions).toEqual({ attempts24h: 1, successRate24h: 100 });
    expect(json.windowHours).toBe(24);
    expect(typeof json.timestamp).toBe("string");
  });

  it("reports a null success rate (not a divide-by-zero NaN) when there were no attempts in the window", async () => {
    const { client } = okClient({
      sync_history: { data: [], error: null },
      workflow_executions: { data: [], error: null },
    });
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(json.sync).toEqual({ attempts24h: 0, successRate24h: null });
    expect(json.workflowExecutions).toEqual({ attempts24h: 0, successRate24h: null });
  });

  it("returns 500 when any underlying query fails", async () => {
    const { client } = okClient({ shops: { data: null, error: { message: "db down" } } });
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(500);
  });
});
