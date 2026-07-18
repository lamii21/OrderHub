import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase-middleware";
import { buildCsp } from "@/lib/csp";

// Same list as lib/supabase-middleware.ts's own PROTECTED_PREFIXES, kept
// here too since the matcher below now also runs on public routes (/,
// /login, /shops/connect's landing state) that don't need a session refresh
// at all.
const SESSION_PREFIXES = [
  "/dashboard",
  "/analytics",
  "/products",
  "/shops",
  "/orders",
  "/admin",
  "/workflows",
];

// Every HTML-rendering route gets a fresh nonce and a CSP (see lib/csp.ts
// for why it's Report-Only, not enforced, and why script-src is
// nonce-based). Session refresh only runs for the subset that actually
// needs an auth check — supabase.auth.getUser() is a real network round
// trip to Supabase, not a free cookie read, so routes that don't gate on
// login (the homepage, /login itself) skip it entirely, unchanged from
// before this CSP work.
export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy-Report-Only", csp);

  const needsSession = SESSION_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix));
  const response = needsSession
    ? await updateSession(request, requestHeaders)
    : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy-Report-Only", csp);
  return response;
}

export const config = {
  matcher: [
    // Every route except static assets, Next's own image optimizer, and
    // the API routes (a webhook, 2 crons, a health check) — none of those
    // last ones render HTML or run a browser's script engine, so a CSP
    // response header on them would be inert, not protective.
    "/((?!api/|_next/static|_next/image|favicon.ico).*)",
  ],
};
