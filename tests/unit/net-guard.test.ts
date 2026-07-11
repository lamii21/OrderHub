import { describe, it, expect, beforeEach } from "vitest";
import { checkUrlSafetySync, assertPublicHttpUrl, UnsafeUrlError } from "@/lib/net-guard";
import { mockedLookup } from "../mocks/dns";

beforeEach(() => {
  mockedLookup.mockClear();
  mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

describe("checkUrlSafetySync", () => {
  it("returns null for an ordinary public https URL", () => {
    expect(checkUrlSafetySync("https://example.com/hook")).toBeNull();
  });

  it("returns null for an ordinary public http URL", () => {
    expect(checkUrlSafetySync("http://example.com/hook")).toBeNull();
  });

  it("rejects an unparsable URL", () => {
    expect(checkUrlSafetySync("not a url")).toMatch(/not a valid url/i);
  });

  it("rejects a non-http(s) protocol", () => {
    expect(checkUrlSafetySync("ftp://example.com")).toMatch(/http or https/i);
  });

  it("rejects a literal loopback IP", () => {
    expect(checkUrlSafetySync("http://127.0.0.1/hook")).toMatch(/private or internal/i);
  });

  it("rejects the cloud metadata endpoint (169.254.169.254)", () => {
    expect(checkUrlSafetySync("http://169.254.169.254/latest/meta-data/")).toMatch(
      /private or internal/i
    );
  });

  it("rejects a literal 10.x private address", () => {
    expect(checkUrlSafetySync("http://10.0.0.5/hook")).toMatch(/private or internal/i);
  });

  it("rejects a literal 192.168.x private address", () => {
    expect(checkUrlSafetySync("http://192.168.1.1/hook")).toMatch(/private or internal/i);
  });

  it("rejects a literal 172.16-31.x private address", () => {
    expect(checkUrlSafetySync("http://172.20.0.1/hook")).toMatch(/private or internal/i);
  });

  it("does not reject a public-looking 172.x address outside the private range", () => {
    expect(checkUrlSafetySync("http://172.64.0.1/hook")).toBeNull();
  });

  it("rejects the hostname 'localhost'", () => {
    expect(checkUrlSafetySync("http://localhost:6379/")).toMatch(/blocked host/i);
  });

  it("rejects an IPv6 loopback literal", () => {
    expect(checkUrlSafetySync("http://[::1]/hook")).toMatch(/private or internal/i);
  });

  it("passes an ordinary hostname through (DNS resolution happens only in the async check)", () => {
    expect(checkUrlSafetySync("https://internal.example.com/hook")).toBeNull();
  });
});

describe("assertPublicHttpUrl", () => {
  it("resolves without throwing for a hostname that resolves to a public address", async () => {
    mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    await expect(assertPublicHttpUrl("https://example.com/hook")).resolves.toBeUndefined();
  });

  it("throws UnsafeUrlError for a hostname that resolves to a private address", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(assertPublicHttpUrl("https://internal.example.com/hook")).rejects.toThrow(
      UnsafeUrlError
    );
  });

  // Regression test for the actual SSRF scenario this guard exists to
  // close: a hostname whose DNS record resolves to the cloud metadata
  // endpoint's link-local range, not just an obviously-internal-looking
  // literal IP typed directly into a config field.
  it("throws for a hostname resolving to the link-local/metadata range", async () => {
    mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(assertPublicHttpUrl("https://metadata-lookalike.example.com/")).rejects.toThrow(
      UnsafeUrlError
    );
  });

  it("blocks the request if ANY resolved address is private, even when others are public", async () => {
    mockedLookup.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(assertPublicHttpUrl("https://multi-homed.example.com/")).rejects.toThrow(
      UnsafeUrlError
    );
  });

  it("throws UnsafeUrlError (not a raw DNS error) when the hostname can't be resolved", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertPublicHttpUrl("https://does-not-exist.invalid/")).rejects.toThrow(
      UnsafeUrlError
    );
  });

  it("never calls DNS lookup for a literal IP — the sync check alone decides", async () => {
    await assertPublicHttpUrl("http://203.0.113.10/hook");
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("throws synchronously-detectable errors (bad protocol) without ever calling DNS lookup", async () => {
    await expect(assertPublicHttpUrl("javascript:alert(1)")).rejects.toThrow(UnsafeUrlError);
    expect(mockedLookup).not.toHaveBeenCalled();
  });
});
