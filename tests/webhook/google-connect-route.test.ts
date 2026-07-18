import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "../mocks/supabase";
import { __resetRateLimitState } from "@/lib/rate-limit";

const { buildGoogleAuthUrl } = vi.hoisted(() => ({ buildGoogleAuthUrl: vi.fn() }));
vi.mock("@/lib/google-oauth", () => ({ buildGoogleAuthUrl }));

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));

import { GET } from "@/app/api/google/connect/route";

function makeRequest(path: string, ip = "203.0.113.5") {
  return new NextRequest(`http://localhost${path}`, { headers: { "x-forwarded-for": ip } });
}

beforeEach(() => {
  buildGoogleAuthUrl.mockReset();
  buildGoogleAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?mock=1");
  __resetRateLimitState();
});

describe("GET /api/google/connect", () => {
  it("redirects to /login when there is no authenticated user", async () => {
    const { client } = createMockSupabase({ user: null });
    holder.client = client;

    const response = await GET(makeRequest("/api/google/connect"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
    expect(buildGoogleAuthUrl).not.toHaveBeenCalled();
  });

  it("redirects to Google's consent screen with the user id and default redirect_to", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;

    const response = await GET(makeRequest("/api/google/connect"));

    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?mock=1");
    expect(buildGoogleAuthUrl).toHaveBeenCalledWith("user-1", "/shops");
  });

  it("honors a same-origin redirect_to query param", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;

    await GET(makeRequest("/api/google/connect?redirect_to=%2Fshops%2Fnew"));

    expect(buildGoogleAuthUrl).toHaveBeenCalledWith("user-1", "/shops/new");
  });

  it("falls back to the default for a protocol-relative redirect_to (open-redirect attempt)", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;

    await GET(makeRequest("/api/google/connect?redirect_to=%2F%2Fevil.example"));

    expect(buildGoogleAuthUrl).toHaveBeenCalledWith("user-1", "/shops");
  });

  it("falls back to the default for an absolute-URL redirect_to (open-redirect attempt)", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;

    await GET(makeRequest("/api/google/connect?redirect_to=https%3A%2F%2Fevil.example"));

    expect(buildGoogleAuthUrl).toHaveBeenCalledWith("user-1", "/shops");
  });

  it("rate limits a single caller without calling buildGoogleAuthUrl once exceeded", async () => {
    const { client } = createMockSupabase({ user: { id: "user-1" } });
    holder.client = client;

    const ip = "198.51.100.40";
    let lastResponse;
    for (let i = 0; i < 11; i++) {
      lastResponse = await GET(makeRequest("/api/google/connect", ip));
    }

    expect(lastResponse!.status).toBe(429);
    expect(buildGoogleAuthUrl).toHaveBeenCalledTimes(10);
  });
});
