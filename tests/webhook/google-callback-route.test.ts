import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { verifyStateToken, exchangeCodeForTokens, saveGoogleAccount } = vi.hoisted(() => ({
  verifyStateToken: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  saveGoogleAccount: vi.fn(),
}));
vi.mock("@/lib/google-oauth", () => ({ verifyStateToken, exchangeCodeForTokens, saveGoogleAccount }));

import { GET } from "@/app/api/google/callback/route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/google/callback${query}`);
}

beforeEach(() => {
  verifyStateToken.mockReset();
  exchangeCodeForTokens.mockReset();
  saveGoogleAccount.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("GET /api/google/callback", () => {
  it("exchanges the code, saves the account, and redirects to redirectTo with google_connected=1", async () => {
    verifyStateToken.mockReturnValue({ uid: "user-1", redirectTo: "/shops/new" });
    exchangeCodeForTokens.mockResolvedValue({
      refreshToken: "r",
      email: "u@gmail.com",
      accessToken: "a",
      expiryDate: null,
    });
    saveGoogleAccount.mockResolvedValue(undefined);

    const response = await GET(makeRequest("?code=abc&state=signed-state"));

    expect(saveGoogleAccount).toHaveBeenCalledWith("user-1", expect.objectContaining({ email: "u@gmail.com" }));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/shops/new");
    expect(location.searchParams.get("google_connected")).toBe("1");
  });

  it("redirects with google_error and never exchanges the code when state fails verification", async () => {
    verifyStateToken.mockReturnValue(null);

    const response = await GET(makeRequest("?code=abc&state=tampered"));

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/shops");
    expect(location.searchParams.get("google_error")).toBeTruthy();
  });

  it("redirects with google_error and never exchanges the code when there is no code param", async () => {
    verifyStateToken.mockReturnValue({ uid: "user-1", redirectTo: "/shops/new" });

    const response = await GET(makeRequest("?state=signed-state"));

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("google_error");
  });

  it("handles Google's own ?error=access_denied (user cancelled) as a clean redirect, no exchange attempted", async () => {
    verifyStateToken.mockReturnValue({ uid: "user-1", redirectTo: "/shops/connect" });

    const response = await GET(makeRequest("?error=access_denied&state=signed-state"));

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/shops/connect");
    expect(location.searchParams.get("google_error")).toBeTruthy();
  });

  it("redirects with a generic google_error (never the raw error) when the exchange throws", async () => {
    verifyStateToken.mockReturnValue({ uid: "user-1", redirectTo: "/shops/new" });
    exchangeCodeForTokens.mockRejectedValue(new Error("invalid_grant: token already used"));

    const response = await GET(makeRequest("?code=abc&state=signed-state"));

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/shops/new");
    expect(location.searchParams.get("google_error")).not.toContain("invalid_grant");
    expect(saveGoogleAccount).not.toHaveBeenCalled();
  });

  it("redirects with a generic google_error when saveGoogleAccount throws", async () => {
    verifyStateToken.mockReturnValue({ uid: "user-1", redirectTo: "/shops/new" });
    exchangeCodeForTokens.mockResolvedValue({
      refreshToken: "r",
      email: "u@gmail.com",
      accessToken: "a",
      expiryDate: null,
    });
    saveGoogleAccount.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(makeRequest("?code=abc&state=signed-state"));

    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("google_error")).not.toContain("database unavailable");
  });
});
