"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Mounted once on the dashboard so a new order shows up on its own —
// replaces "revalidate = 0 means fresh on the *next* visit" with an
// actual push. Renders nothing; its only job is the subscription effect.
// router.refresh() re-runs the Server Component's own data fetch (RLS
// still applies, same as any normal navigation) rather than duplicating
// any query here.
//
// Silently does nothing if NEXT_PUBLIC_SUPABASE_URL/ANON_KEY aren't
// configured (see lib/supabase-browser.ts) — the dashboard still works,
// it just isn't real-time until those are set.
//
// Requires the `orders` table to be added to Postgres's
// `supabase_realtime` publication (Supabase Dashboard → Database →
// Replication) — a project configuration step, not something this code
// can do for itself.
export function RealtimeDashboardRefresher() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel("dashboard-orders")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, () => {
        router.refresh();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
