// Content-Security-Policy for every HTML-rendering route. Shipped as
// Content-Security-Policy-Report-Only (see proxy.ts), not enforced — this
// project has no browser test harness (see vitest.config.ts's own note:
// "no React component tests"), so there's no automated way to confirm this
// exact policy doesn't break Recharts' rendering (components/charts/*.tsx)
// or Next's own hydration scripts before it ships. Report-Only carries zero
// risk of breaking the app either way: violations only show up in the
// browser console (and, if a report-uri were configured, a collector —
// none is, since there's nowhere to send them yet). Once a deploy or two
// shows zero unexpected violations in real traffic, flip the header name in
// proxy.ts from Content-Security-Policy-Report-Only to
// Content-Security-Policy to actually enforce it.
//
// script-src uses a per-request nonce + 'strict-dynamic' — the policy
// Next.js's own docs recommend for the App Router, specifically because
// Next injects its own inline <script> tags for streaming RSC/hydration
// payloads; a policy without a nonce would need 'unsafe-inline' on
// script-src to avoid blocking Next itself, which defeats CSP's actual
// point. style-src allows 'unsafe-inline' deliberately: Recharts sets
// inline style attributes on the SVG elements it renders, and there's no
// nonce mechanism for style attributes the way there is for scripts.
export function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}
