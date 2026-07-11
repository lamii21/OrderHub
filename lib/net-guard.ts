import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Blocks outbound requests to internal/private network destinations —
// closes an SSRF gap where a user-supplied URL (a shop's store_url, a
// workflow's Webhook/Delivery step config) could otherwise make the server
// itself probe or attack its own internal network (cloud metadata
// endpoints, localhost services, private-range hosts) instead of the
// public API it's meant to reach. Shared by every call site that builds an
// outbound request from user-supplied input: lib/platforms/*.ts and the
// Webhook/Delivery automation modules.
//
// This resolves the hostname and checks the IP it actually comes back
// with, not just the hostname string — a hostname like
// "internal.example.com" that happens to resolve to a private IP would
// otherwise slip past a string-only check. It does not fully close
// DNS-rebinding (the IP could change between this check and the fetch()
// call right after it), which would need a custom fetch agent pinning the
// resolved IP — deliberately out of scope for a dependency-free check;
// combined with the request timeouts already on every one of these call
// sites, the practical exposure window is small.
export class UnsafeUrlError extends Error {}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 || // 10.0.0.0/8 — private
    a === 127 || // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 — link-local, includes the 169.254.169.254 cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 — private
    (a === 192 && b === 168) || // 192.168.0.0/16 — private
    a === 0 // 0.0.0.0/8
  );
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" || // loopback
    normalized === "::" ||
    normalized.startsWith("fe80:") || // link-local
    normalized.startsWith("fc") || // fc00::/7 — unique local
    normalized.startsWith("fd") ||
    normalized.startsWith("::ffff:127.") || // IPv4-mapped loopback
    normalized.startsWith("::ffff:10.") || // IPv4-mapped private (partial, cheap coverage)
    normalized.startsWith("::ffff:169.254.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isBlockedIp(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

// The WHATWG URL parser keeps an IPv6 literal's brackets as part of
// `.hostname` (e.g. "[::1]"), but net.isIP() and dns.lookup() both expect
// the bare address — every hostname extracted from a parsed URL needs this
// before it's checked or resolved.
function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

// Synchronous subset of the check: protocol, blocked hostnames, and a
// literal IP address in the URL — everything that doesn't require a DNS
// round trip. Used at config-save time (validateConfig() implementations
// are synchronous by contract), so an obviously-unsafe URL is rejected
// immediately with a clear message instead of only failing the next time
// the step actually runs. Returns a reason string when unsafe, or null
// when this subset of checks passes (a plain hostname still needs the
// async check below before it's actually safe to call).
export function checkUrlSafetySync(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Not a valid URL.";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "URL must use http or https.";
  }

  const hostname = stripBrackets(parsed.hostname.toLowerCase());

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return "URL points at a blocked host.";
  }

  if (isIP(hostname) && isBlockedIp(hostname)) {
    return "URL resolves to a private or internal address.";
  }

  return null;
}

// Full check, including a DNS lookup for a plain hostname — call this
// immediately before making the actual request, with the same URL that
// will be fetched. Throws UnsafeUrlError when the URL is not safe to call.
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  const syncReason = checkUrlSafetySync(rawUrl);
  if (syncReason) {
    throw new UnsafeUrlError(syncReason);
  }

  const parsed = new URL(rawUrl);
  const hostname = stripBrackets(parsed.hostname.toLowerCase());

  // Literal IP was already fully checked by checkUrlSafetySync above.
  if (isIP(hostname)) {
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError("Could not resolve host.");
  }

  if (addresses.some((a) => isBlockedIp(a.address))) {
    throw new UnsafeUrlError("URL resolves to a private or internal address.");
  }
}
