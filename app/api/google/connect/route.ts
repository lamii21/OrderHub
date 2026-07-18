import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { buildGoogleAuthUrl } from "@/lib/google-oauth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const DEFAULT_REDIRECT = "/shops";

// Only a same-origin relative path is ever honored — redirect_to is
// attacker-reachable (anyone can craft a link to this route with any query
// string), and it gets carried through the signed state token unmodified.
// Without this check, a crafted `?redirect_to=https://evil.example` would
// send an already-logged-in user back to an attacker's page after they
// grant Google consent (an open redirect riding on the OAuth flow).
function sanitizeRedirectTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_REDIRECT;
  }
  return value;
}

// Starts the per-user Google OAuth flow (see lib/google-oauth.ts). Outside
// proxy.ts's session-refresh matcher (which excludes api/*), so the
// logged-in-user check here is load-bearing, not redundant.
export async function GET(request: NextRequest) {
  const rateLimit = checkRateLimit(`google-connect:${getClientIp(request.headers)}`, {
    max: 10,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000)) } }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const redirectTo = sanitizeRedirectTo(request.nextUrl.searchParams.get("redirect_to"));

  return NextResponse.redirect(buildGoogleAuthUrl(user.id, redirectTo));
}
