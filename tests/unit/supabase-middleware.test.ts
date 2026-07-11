import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser },
  })),
}));

import { updateSession } from "@/lib/supabase-middleware";

function makeRequest(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  getUser.mockReset();
});

describe("updateSession", () => {
  it("redirects to /login when unauthenticated on a protected route", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await updateSession(makeRequest("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("passes through when authenticated on a protected route", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await updateSession(makeRequest("/dashboard"));

    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/orders/1", "/shops", "/shops/1", "/products", "/analytics", "/admin"])(
    "treats %s as protected",
    async (path) => {
      getUser.mockResolvedValue({ data: { user: null } });

      const response = await updateSession(makeRequest(path));

      expect(response.headers.get("location")).toContain("/login");
    }
  );

  it("passes through unauthenticated requests on a public route, without redirecting", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await updateSession(makeRequest("/login"));

    expect(response.headers.get("location")).toBeNull();
  });

  // Regression guard for the CSP work: proxy.ts passes its own nonce-bearing
  // Headers instance so Next's renderer can pick up the CSP nonce — this
  // must not break the underlying auth-redirect behavior either way.
  it("still redirects correctly when the caller passes its own requestHeaders (the CSP nonce case)", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const customHeaders = new Headers();
    customHeaders.set("x-nonce", "test-nonce");

    const response = await updateSession(makeRequest("/dashboard"), customHeaders);

    expect(response.headers.get("location")).toContain("/login");
  });

  it("still passes an authenticated user through when requestHeaders is provided", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const customHeaders = new Headers();
    customHeaders.set("x-nonce", "test-nonce");

    const response = await updateSession(makeRequest("/dashboard"), customHeaders);

    expect(response.headers.get("location")).toBeNull();
  });
});
