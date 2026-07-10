import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deliberately not a Content-Security-Policy or Strict-Transport-Security
  // header here — CSP needs careful, tested tuning against this app's own
  // script/style sources to avoid breaking it (a "do not redesign" risk,
  // not a quick add), and HSTS is already applied by Vercel's own edge for
  // any production deployment there; hand-rolling it risks a wrong value
  // locking out an environment that doesn't yet serve HTTPS everywhere
  // (e.g. local development). The 4 below are safe, broadly-compatible
  // defaults with no tuning required and no way to break existing pages.
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
        ],
      },
    ];
  },
};

export default nextConfig;
