import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";

// User-scoped Supabase client for Server Components and Server Actions: it
// reads the logged-in user's session from cookies and sends their JWT with
// every query, so Postgres RLS policies apply automatically — this is what
// makes "users only see their own data" work with no manual filters in the
// app code. Uses the anon key, never the service-role one (see lib/supabase.ts
// for that — the "system" client used only where RLS must be bypassed).
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component, where cookies can't be set.
          // Safe to ignore — middleware refreshes the session on every
          // request, so a Server Component never needs to write one itself.
        }
      },
    },
  });
}
