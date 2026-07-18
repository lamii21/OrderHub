import { describe, it, expect } from "vitest";
import { encrypt, decrypt, deriveHmacKey } from "@/lib/crypto";

describe("encrypt/decrypt", () => {
  it("round-trips a plaintext string", () => {
    const ciphertext = encrypt("1//0abc-refresh-token-value");
    expect(ciphertext).not.toContain("1//0abc-refresh-token-value");
    expect(decrypt(ciphertext)).toBe("1//0abc-refresh-token-value");
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const first = encrypt("same-plaintext");
    const second = encrypt("same-plaintext");
    expect(first).not.toBe(second);
    expect(decrypt(first)).toBe("same-plaintext");
    expect(decrypt(second)).toBe("same-plaintext");
  });

  it("throws on a tampered payload (GCM auth tag mismatch)", () => {
    const ciphertext = encrypt("secret-value");
    const raw = Buffer.from(ciphertext, "base64");
    raw[raw.length - 1] ^= 0xff; // flip the last byte of the ciphertext
    const tampered = raw.toString("base64");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY is missing", () => {
    const original = process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY;

    expect(() => encrypt("x")).toThrow(/Missing required environment variable/);

    process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY = original;
  });

  it("throws when the key doesn't decode to exactly 32 bytes", () => {
    const original = process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY;
    process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");

    expect(() => encrypt("x")).toThrow(/must decode to exactly 32 bytes/);

    process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY = original;
  });
});

describe("deriveHmacKey", () => {
  it("is deterministic for the same encryption key", () => {
    expect(deriveHmacKey().equals(deriveHmacKey())).toBe(true);
  });

  it("differs from the raw encryption key (not reused verbatim)", () => {
    const rawKey = Buffer.from(process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY!, "base64");
    expect(deriveHmacKey().equals(rawKey)).toBe(false);
  });
});
