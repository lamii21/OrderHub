import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Content-Security-Policy lives in proxy.ts instead of here (see
  // lib/csp.ts) — it needs a fresh nonce per request for Next's own
  // hydration scripts, which only middleware can generate; this file's
  // headers() runs once at build time and can only emit static values.
  // Shipped as Report-Only there, not enforced, until a deploy or two
  // confirms it doesn't break anything real traffic depends on.
  //
  // HSTS below still applies even though Vercel's own edge already adds
  // it for any Vercel deployment: that's an implicit, platform-specific
  // guarantee, and this app shouldn't depend on "whichever host we're on
  // happens to add this" for something security-relevant. Harmless in
  // local dev (plain http://localhost): browsers only ever honor/cache an
  // HSTS header received over an actual HTTPS connection, by spec, so this
  // has no effect there either way. No `preload` — that's a one-way
  // submission to browsers' built-in preload list, not this codebase's
  // call to make on a deployment's behalf.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
