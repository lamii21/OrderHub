import { createBrowserClient } from "@supabase/ssr";

// Browser-only Supabase client, used for exactly one thing today:
// components/realtime-dashboard-refresher.tsx's postgres_changes
// subscription. Every other query in this app runs server-side
// (lib/supabase.ts, lib/supabase-server.ts) — this is the one exception,
// since a Realtime subscription is inherently a client-side WebSocket
// connection a Server Component can't open.
//
// Requires NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY — the
// same URL and anon key as SUPABASE_URL/SUPABASE_ANON_KEY (safe to expose
// client-side by design; RLS is what actually protects the data, not
// keeping the anon key secret), just re-exposed under the NEXT_PUBLIC_
// prefix Next.js requires before a var is included in the browser bundle
// at all — `SUPABASE_URL` itself is never readable from client code no
// matter how harmless its value is.
//
// Returns null (never throws) when unset, so the one feature that needs
// this degrades to "not real-time" instead of breaking the page — same
// graceful-degradation posture as every other optional integration in
// this project (see provisionShopSpreadsheetOrSkip's own comment).
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return createBrowserClient(url, anonKey);
}
