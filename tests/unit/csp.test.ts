import { describe, it, expect } from "vitest";
import { buildCsp } from "@/lib/csp";

describe("buildCsp", () => {
  it("embeds the given nonce into script-src", () => {
    const csp = buildCsp("abc123");
    expect(csp).toContain("'nonce-abc123'");
  });

  it("never allows unsafe-inline or unsafe-eval on script-src (only style-src is relaxed)", () => {
    const csp = buildCsp("abc123");
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("blocks plugin/object embeds and framing entirely", () => {
    const csp = buildCsp("abc123");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("restricts default-src, connect-src, form-action, and base-uri to same-origin", () => {
    const csp = buildCsp("abc123");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("produces a different policy string for a different nonce (never a fixed/predictable value)", () => {
    expect(buildCsp("nonce-one")).not.toBe(buildCsp("nonce-two"));
  });
});
