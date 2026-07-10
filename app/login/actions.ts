"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";

// Same helper already used on the /api/orders webhook — Server Actions get
// the caller's headers via next/headers instead of a Request object, but
// it's the identical checkRateLimit(key, {max, windowMs}) call either way.
// Keyed on IP, not email: the goal is to stop one caller from grinding
// through many passwords/many accounts, not to lock out a legitimate user
// who mistypes their own password a few times.
async function clientIp(): Promise<string> {
  const headerList = await headers();
  return headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const ip = await clientIp();
  const rateLimit = checkRateLimit(`login:${ip}`, { max: 10, windowMs: 5 * 60_000 });
  if (!rateLimit.allowed) {
    logger.warn("auth.login_rate_limited", { ip });
    redirect(`/login?error=${encodeURIComponent("Too many attempts. Please wait a few minutes and try again.")}`);
  }

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Email and password are required.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // email only, never the password — logged so repeated failed attempts
    // against one address are visible in deployment logs even without a
    // dedicated lockout mechanism.
    logger.audit("auth.login_failed", { email, ip });
    redirect(`/login?error=${encodeURIComponent("Invalid email or password.")}`);
  }

  logger.audit("auth.login_succeeded", { email });
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  logger.audit("auth.logout", { email: user?.email });
  redirect("/login");
}
