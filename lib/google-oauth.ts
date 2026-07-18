import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { google } from "googleapis";
import { requireEnv } from "@/lib/env";
import { encrypt, decrypt, deriveHmacKey } from "@/lib/crypto";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// Everything about *connecting* a Google account (per app user) — the
// consent URL, code exchange, CSRF state signing, and token storage.
// lib/google-sheets.ts (using an already-connected account to touch
// Drive/Sheets) is a separate file/concern, same split as lib/supabase.ts
// (service client) vs lib/supabase-server.ts (per-request client).

// openid+email let the connected account's email come back in the token
// response's id_token, no separate userinfo API call/extra scope needed.
// drive.file (not the full drive scope) + spreadsheets: the same narrow,
// minimal-blast-radius scopes the old service account used.
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Built fresh per call, deliberately not cached as a module-level singleton:
// a cached instance would have setCredentials() called on it per-request,
// which risks leaking one user's refresh token into another request on a
// warm serverless instance — a real cross-tenant bug, not just a style
// preference.
function getOAuth2Client() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    requireEnv("GOOGLE_OAUTH_REDIRECT_URI")
  );
}

type StatePayload = { uid: string; redirectTo: string; nonce: string; iat: number };

// Signed, self-contained state token — {uid, redirectTo, nonce, iat} plus an
// HMAC-SHA256 tag, both base64url-encoded. Chosen over relying on the
// session cookie surviving the redirect to google.com and back: this way
// the callback route never depends on cookie SameSite behavior across that
// hop, and can recover which user/where-to-redirect purely from the
// verified token itself.
export function buildStateToken(userId: string, redirectTo: string): string {
  const payload: StatePayload = {
    uid: userId,
    redirectTo,
    nonce: randomBytes(16).toString("hex"),
    iat: Date.now(),
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", deriveHmacKey()).update(encodedPayload).digest("base64url");

  return `${encodedPayload}.${signature}`;
}

// Rejects a missing/malformed/tampered/expired token by returning null —
// callers treat that as "can't trust this state, fail closed" (never
// proceed to a token exchange without a verified uid).
export function verifyStateToken(token: string): { uid: string; redirectTo: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, signature] = parts;
  const expectedSignature = createHmac("sha256", deriveHmacKey())
    .update(encodedPayload)
    .digest("base64url");

  const providedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (Date.now() - payload.iat > STATE_MAX_AGE_MS) return null;

  return { uid: payload.uid, redirectTo: payload.redirectTo };
}

// access_type: "offline" + prompt: "consent" together guarantee a
// refresh_token comes back — without "consent", Google only issues one on a
// user's *first ever* grant to this app, and a disconnect-then-reconnect
// needs a fresh one every time.
export function buildGoogleAuthUrl(userId: string, redirectTo: string): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: buildStateToken(userId, redirectTo),
  });
}

export type ExchangedTokens = {
  refreshToken: string;
  email: string;
  accessToken: string;
  expiryDate: number | null;
};

// Throws (uncaught) if Google's response has no refresh_token — this can
// legitimately happen if prompt: "consent" is somehow dropped, and the
// caller (the callback route) must treat it as a hard error, not silently
// store nothing.
export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token for this authorization code.");
  }
  if (!tokens.id_token || !tokens.access_token) {
    throw new Error("Google's token response is missing id_token or access_token.");
  }

  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token,
    audience: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
  });
  const email = ticket.getPayload()?.email;

  if (!email) {
    throw new Error("Google's ID token did not include an email address.");
  }

  return {
    refreshToken: tokens.refresh_token,
    email,
    accessToken: tokens.access_token,
    expiryDate: tokens.expiry_date ?? null,
  };
}

// Written via the service-role client, not the RLS-scoped one: this is
// called from app/api/google/callback/route.ts, a redirect landing from
// google.com rather than a same-origin form submission, so it shouldn't
// depend on the session cookie surviving that hop (see schema.sql's comment
// on google_accounts for the same reasoning).
export async function saveGoogleAccount(userId: string, tokens: ExchangedTokens): Promise<void> {
  const { error } = await supabase.from("google_accounts").upsert(
    {
      user_id: userId,
      google_email: tokens.email,
      encrypted_refresh_token: encrypt(tokens.refreshToken),
      access_token: tokens.accessToken,
      access_token_expires_at: tokens.expiryDate ? new Date(tokens.expiryDate).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

export type GoogleConnectionStatus = { connected: boolean; email: string | null };

export async function getGoogleConnectionStatus(userId: string): Promise<GoogleConnectionStatus> {
  const { data } = await supabase
    .from("google_accounts")
    .select("google_email")
    .eq("user_id", userId)
    .maybeSingle();

  return { connected: data !== null, email: data?.google_email ?? null };
}

// Best-effort remote revocation before deleting the local row — this is a
// credential, not a spreadsheet, so unlike regenerateSpreadsheet's "leave
// the old sheet alone" precedent, a merely-locally-deleted token stays
// valid at Google's end until the user separately visits their Google
// Account permissions page. The revoke call is wrapped so a failure there
// (network error, already-revoked token) never blocks removing the local
// row — the user asked to disconnect, and that must always succeed locally.
export async function disconnectGoogleAccount(userId: string): Promise<void> {
  const { data } = await supabase
    .from("google_accounts")
    .select("encrypted_refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (data) {
    try {
      await getOAuth2Client().revokeToken(decrypt(data.encrypted_refresh_token));
    } catch (err) {
      logger.warn("google_account.revoke_failed", { userId, error: String(err) });
    }
  }

  const { error } = await supabase.from("google_accounts").delete().eq("user_id", userId);
  if (error) {
    throw new Error(error.message);
  }
}

// Internal — used by lib/google-sheets.ts to build the per-user client that
// actually talks to Drive/Sheets. Returns null when the user has never
// connected (or has since disconnected), letting callers decide what "no
// Google account" means for their own flow (provisionShopSpreadsheetOrSkip
// swallows it; provisionShopSpreadsheet/regenerateSpreadsheet surface it).
export async function buildUserOAuth2Client(
  userId: string
): Promise<InstanceType<typeof google.auth.OAuth2> | null> {
  const { data } = await supabase
    .from("google_accounts")
    .select("encrypted_refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;

  const client = getOAuth2Client();
  // googleapis auto-refreshes the access token on demand from the refresh
  // token whenever a request needs one and none is cached on this instance
  // — since a fresh client is built per call, that's every call. The
  // access_token/access_token_expires_at columns exist for future
  // observability/optimization only; nothing here reads them back as the
  // source of truth.
  client.setCredentials({ refresh_token: decrypt(data.encrypted_refresh_token) });

  return client;
}

// Lets appendOrderRows/appendRowToSheet (lib/google-sheets.ts) — called from
// sync and automation-module code that has a shopId, not a userId — resolve
// the right OAuth identity without adding userId to ShopForSync/
// SyncableShop or threading it through the AutomationModule interface,
// which deliberately never carries shop/tenant identity (see
// lib/automation-modules/types.ts).
export async function getUserIdForShop(shopId: number): Promise<string | null> {
  const { data } = await supabase.from("shops").select("user_id").eq("id", shopId).maybeSingle();
  return data?.user_id ?? null;
}
