import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { updateSession } = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase-middleware", () => ({ updateSession }));

import { proxy, config } from "@/proxy";

function makeRequest(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  updateSession.mockReset();
});

describe("proxy", () => {
  it("calls updateSession (session refresh) for a protected route and sets the CSP header on its response", async () => {
    updateSession.mockResolvedValue(NextResponse.next());

    const response = await proxy(makeRequest("/dashboard"));

    expect(updateSession).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("default-src 'self'");
  });

  it("skips updateSession entirely for a public route, but still sets the CSP header", async () => {
    const response = await proxy(makeRequest("/login"));

    expect(updateSession).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("default-src 'self'");
  });

  it("passes a per-request nonce through to updateSession's requestHeaders so Next's renderer can pick it up", async () => {
    updateSession.mockResolvedValue(NextResponse.next());

    await proxy(makeRequest("/shops"));

    const [, requestHeaders] = updateSession.mock.calls[0] as [NextRequest, Headers];
    const nonce = requestHeaders.get("x-nonce");
    expect(nonce).toBeTruthy();
    expect(requestHeaders.get("Content-Security-Policy-Report-Only")).toContain(`'nonce-${nonce}'`);
  });

  it("generates a different nonce on every call (never a fixed/predictable value)", async () => {
    const first = await proxy(makeRequest("/login"));
    const second = await proxy(makeRequest("/login"));

    expect(first.headers.get("Content-Security-Policy-Report-Only")).not.toBe(
      second.headers.get("Content-Security-Policy-Report-Only")
    );
  });

  it("excludes API routes, static assets, and the image optimizer from the matcher", () => {
    expect(config.matcher).toEqual(["/((?!api/|_next/static|_next/image|favicon.ico).*)"]);
  });
});
