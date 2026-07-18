import { NextRequest, NextResponse } from "next/server";
import { verifyStateToken, exchangeCodeForTokens, saveGoogleAccount } from "@/lib/google-oauth";
import { logger } from "@/lib/logger";

const DEFAULT_REDIRECT = "/shops";

function redirectWithParam(request: NextRequest, path: string, param: string, value: string) {
  const url = new URL(path, request.url);
  url.searchParams.set(param, value);
  return NextResponse.redirect(url);
}

// Lands here after the user grants (or denies) consent on Google's own
// screen — see app/api/google/connect/route.ts for what sends them there.
// Never trusts the session cookie for identity: state is a signed,
// self-contained token (lib/google-oauth.ts's buildStateToken/
// verifyStateToken) carrying the user id and where to redirect back to, so
// this route works regardless of cookie SameSite behavior across the
// redirect from google.com.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const googleError = request.nextUrl.searchParams.get("error");

  const verified = state ? verifyStateToken(state) : null;
  const redirectTo = verified?.redirectTo ?? DEFAULT_REDIRECT;

  // The user cancelled the consent screen (or Google reported some other
  // problem) — a clean, expected outcome, not a failure worth logging.
  if (googleError) {
    return redirectWithParam(
      request,
      redirectTo,
      "google_error",
      "Google sign-in was cancelled."
    );
  }

  // Missing/expired/tampered state, or no code at all — never proceed to a
  // token exchange without a verified uid.
  if (!verified || !code) {
    return redirectWithParam(
      request,
      DEFAULT_REDIRECT,
      "google_error",
      "Could not verify the Google sign-in request. Please try again."
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveGoogleAccount(verified.uid, tokens);
  } catch (err) {
    // Never surface the raw error (may reference tokens/credentials) — same
    // rule lib/google-sheets.ts's provisionShopSpreadsheetOrSkip follows.
    logger.error("google_account.connect_failed", { userId: verified.uid, error: String(err) });
    return redirectWithParam(
      request,
      redirectTo,
      "google_error",
      "Could not connect your Google account. Please try again."
    );
  }

  logger.audit("google_account.connected", { userId: verified.uid });

  return redirectWithParam(request, redirectTo, "google_connected", "1");
}
