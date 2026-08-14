import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Deliberately simple — no date library, just the handful of buckets this
// app's sync cadence (manual, occasional) actually needs.
export function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// decodeURIComponent throws on a malformed percent-escape (e.g. a lone "%"
// reaching the URL by hand-editing or a broken redirect) — every page that
// echoes a `?error=` search param back into an <ErrorBanner> was calling it
// directly, which would crash the whole page to the root error boundary
// over what should be a harmless "just show the raw text" fallback.
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// UTC midnight for "today" — the same day-boundary /admin already computes
// inline for its Today/This Week/This Month filters, pulled out so a
// Server Action (which has no page-level date math to reuse) can compute
// the identical boundary without duplicating it.
export function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
