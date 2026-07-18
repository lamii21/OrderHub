import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const { generateAuthUrl, getToken, verifyIdToken, revokeToken, setCredentials, OAuth2Ctor } =
  vi.hoisted(() => ({
    generateAuthUrl: vi.fn(),
    getToken: vi.fn(),
    verifyIdToken: vi.fn(),
    revokeToken: vi.fn(),
    setCredentials: vi.fn(),
    OAuth2Ctor: vi.fn(),
  }));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      // A real `function` (not an arrow fn) so `new google.auth.OAuth2(...)`
      // works — returning an object from a constructor overrides the
      // default `this`, so every instance shares these same tracked spies.
      OAuth2: vi.fn(function OAuth2(...args: unknown[]) {
        OAuth2Ctor(...args);
        return { generateAuthUrl, getToken, verifyIdToken, revokeToken, setCredentials };
      }),
    },
  },
}));

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import {
  buildStateToken,
  verifyStateToken,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  saveGoogleAccount,
  getGoogleConnectionStatus,
  disconnectGoogleAccount,
  buildUserOAuth2Client,
  getUserIdForShop,
} from "@/lib/google-oauth";

beforeEach(() => {
  generateAuthUrl.mockReset();
  getToken.mockReset();
  verifyIdToken.mockReset();
  revokeToken.mockReset();
  setCredentials.mockReset();
  OAuth2Ctor.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildStateToken / verifyStateToken", () => {
  it("round-trips uid and redirectTo", () => {
    const token = buildStateToken("user-1", "/shops/new");
    expect(verifyStateToken(token)).toEqual({ uid: "user-1", redirectTo: "/shops/new" });
  });

  it("rejects a tampered token", () => {
    const token = buildStateToken("user-1", "/shops/new");
    const tampered = token.slice(0, -2) + "xx";
    expect(verifyStateToken(tampered)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyStateToken("not-a-valid-token")).toBeNull();
    expect(verifyStateToken("")).toBeNull();
  });

  it("rejects an expired token (older than 10 minutes)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = buildStateToken("user-1", "/shops/new");

    vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
    expect(verifyStateToken(token)).toBeNull();
  });

  it("accepts a token just under the 10 minute limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = buildStateToken("user-1", "/shops/new");

    vi.setSystemTime(new Date("2026-01-01T00:09:00Z"));
    expect(verifyStateToken(token)).toEqual({ uid: "user-1", redirectTo: "/shops/new" });
  });
});

describe("buildGoogleAuthUrl", () => {
  it("requests offline access, forces consent, and passes the minimal scopes + signed state", () => {
    generateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?mock=1");

    const url = buildGoogleAuthUrl("user-1", "/shops/connect");

    expect(url).toBe("https://accounts.google.com/o/oauth2/v2/auth?mock=1");
    expect(generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: "offline",
        prompt: "consent",
        scope: expect.arrayContaining([
          "openid",
          "email",
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/spreadsheets",
        ]),
        state: expect.any(String),
      })
    );
    expect(verifyStateToken(generateAuthUrl.mock.calls[0][0].state)).toEqual({
      uid: "user-1",
      redirectTo: "/shops/connect",
    });
  });
});

describe("exchangeCodeForTokens", () => {
  it("returns the refresh token, access token, and email from a valid response", async () => {
    getToken.mockResolvedValue({
      tokens: {
        refresh_token: "refresh-abc",
        access_token: "access-abc",
        id_token: "id-token-abc",
        expiry_date: 1234567890,
      },
    });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "user@gmail.com" }) });

    const result = await exchangeCodeForTokens("auth-code");

    expect(result).toEqual({
      refreshToken: "refresh-abc",
      email: "user@gmail.com",
      accessToken: "access-abc",
      expiryDate: 1234567890,
    });
  });

  it("throws when Google's response has no refresh_token", async () => {
    getToken.mockResolvedValue({ tokens: { access_token: "access-abc", id_token: "id-token-abc" } });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(/did not return a refresh token/);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("throws when the ID token has no email", async () => {
    getToken.mockResolvedValue({
      tokens: { refresh_token: "refresh-abc", access_token: "access-abc", id_token: "id-token-abc" },
    });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({}) });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(/did not include an email/);
  });
});

describe("saveGoogleAccount / getGoogleConnectionStatus / disconnectGoogleAccount / getUserIdForShop", () => {
  it("saveGoogleAccount upserts an encrypted refresh token, never the raw one", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await saveGoogleAccount("user-1", {
      refreshToken: "raw-refresh-token",
      email: "user@gmail.com",
      accessToken: "access-abc",
      expiryDate: 1735689600000,
    });

    const builder = client.from.mock.results[0].value;
    const [payload, opts] = builder.__calls.upsert[0];
    expect(opts).toEqual({ onConflict: "user_id" });
    expect(payload.google_email).toBe("user@gmail.com");
    expect(payload.encrypted_refresh_token).not.toContain("raw-refresh-token");
  });

  it("getGoogleConnectionStatus reports connected when a row exists", async () => {
    const { client } = createMockSupabase({
      responses: { google_accounts: { data: { google_email: "user@gmail.com" }, error: null } },
    });
    holder.client = client;

    expect(await getGoogleConnectionStatus("user-1")).toEqual({
      connected: true,
      email: "user@gmail.com",
    });
  });

  it("getGoogleConnectionStatus reports not connected when no row exists", async () => {
    const { client } = createMockSupabase({
      responses: { google_accounts: { data: null, error: null } },
    });
    holder.client = client;

    expect(await getGoogleConnectionStatus("user-1")).toEqual({ connected: false, email: null });
  });

  it("disconnectGoogleAccount tolerates an undecryptable stored token (decrypt failure) and still deletes the row", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        google_accounts: [
          { data: { encrypted_refresh_token: "not-real-ciphertext" }, error: null },
          { data: null, error: null },
        ],
      },
    });
    holder.client = client;
    revokeToken.mockRejectedValue(new Error("already revoked"));

    await disconnectGoogleAccount("user-1");

    expect(builders.google_accounts[1].__calls.delete).toBeDefined();
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("disconnectGoogleAccount deletes the local row even when remote revoke fails, given a real token", async () => {
    const { encrypt } = await import("@/lib/crypto");
    const { client, builders } = createMockSupabase({
      responses: {
        google_accounts: [
          { data: { encrypted_refresh_token: encrypt("refresh-abc") }, error: null },
          { data: null, error: null },
        ],
      },
    });
    holder.client = client;
    revokeToken.mockRejectedValue(new Error("network error"));

    await disconnectGoogleAccount("user-1");

    expect(revokeToken).toHaveBeenCalledWith("refresh-abc");
    expect(builders.google_accounts[1].__calls.delete).toBeDefined();
  });

  it("getUserIdForShop returns the shop's user_id", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: { user_id: "user-42" }, error: null } },
    });
    holder.client = client;

    expect(await getUserIdForShop(7)).toBe("user-42");
  });

  it("getUserIdForShop returns null for an unknown shop", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    expect(await getUserIdForShop(999)).toBeNull();
  });
});

describe("buildUserOAuth2Client", () => {
  it("returns null when the user has no connected Google account", async () => {
    const { client } = createMockSupabase({ responses: { google_accounts: { data: null, error: null } } });
    holder.client = client;

    expect(await buildUserOAuth2Client("user-1")).toBeNull();
  });

  it("builds a client with the decrypted refresh token set as credentials", async () => {
    const { encrypt } = await import("@/lib/crypto");
    const { client } = createMockSupabase({
      responses: { google_accounts: { data: { encrypted_refresh_token: encrypt("refresh-abc") }, error: null } },
    });
    holder.client = client;

    const result = await buildUserOAuth2Client("user-1");

    expect(result).not.toBeNull();
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: "refresh-abc" });
  });
});
