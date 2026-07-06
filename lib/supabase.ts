import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

// Server-only client (service role key). Never import this from a "use client" component.
export const supabase = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);
