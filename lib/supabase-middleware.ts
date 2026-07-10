import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";

// "/shops" covers /shops, /shops/[id], /shops/new, and /shops/connect; "/orders"
// covers /orders/[id] — all by simple prefix, since none of this app's routes
// nest deeper.
const PROTECTED_PREFIXES = ["/dashboard", "/analytics", "/products", "/shops", "/orders", "/admin"];

// Runs on every matched request (see proxy.ts — Next's newer name for what
// used to be called "middleware"). This is the actual
// security gate — it redirects unauthenticated visitors to /login before any
// protected page renders. RLS (supabase/schema.sql) is the second, independent
// layer: even if this ever failed to run, the pages themselves query with the
// user's own session, so an unauthenticated/wrong-user request just gets back
// zero rows, never someone else's data.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix)
  );

  if (!user && isProtected) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}
