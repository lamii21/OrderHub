import { createHmac } from "crypto";
import { describe, it, expect } from "vitest";
import { isWhatsAppWebhookSecrets, verifyWebhookChallenge, verifyWebhookSignature } from "@/lib/whatsapp-webhook";

describe("isWhatsAppWebhookSecrets", () => {
  it("accepts a value with both appSecret and verifyToken as strings", () => {
    expect(isWhatsAppWebhookSecrets({ appSecret: "s", verifyToken: "t" })).toBe(true);
  });

  it("rejects null, a missing field, or a non-string field", () => {
    expect(isWhatsAppWebhookSecrets(null)).toBe(false);
    expect(isWhatsAppWebhookSecrets({ appSecret: "s" })).toBe(false);
    expect(isWhatsAppWebhookSecrets({ appSecret: "s", verifyToken: 123 })).toBe(false);
  });

  it("does not require accessToken/phoneNumberId to also be present", () => {
    expect(isWhatsAppWebhookSecrets({ appSecret: "s", verifyToken: "t", accessToken: "a" })).toBe(true);
  });
});

describe("verifyWebhookChallenge", () => {
  it("returns the challenge when mode is subscribe and the token matches", () => {
    const result = verifyWebhookChallenge("secret-token", {
      mode: "subscribe",
      token: "secret-token",
      challenge: "12345",
    });
    expect(result).toBe("12345");
  });

  it("returns null when the token does not match", () => {
    const result = verifyWebhookChallenge("secret-token", {
      mode: "subscribe",
      token: "wrong-token",
      challenge: "12345",
    });
    expect(result).toBeNull();
  });

  it("returns null when mode isn't subscribe", () => {
    const result = verifyWebhookChallenge("secret-token", {
      mode: "unsubscribe",
      token: "secret-token",
      challenge: "12345",
    });
    expect(result).toBeNull();
  });

  it("returns null when challenge is missing", () => {
    const result = verifyWebhookChallenge("secret-token", { mode: "subscribe", token: "secret-token", challenge: null });
    expect(result).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  const appSecret = "app-secret-value";
  const rawBody = JSON.stringify({ entry: [] });

  function sign(secret: string, body: string): string {
    return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  }

  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(appSecret, rawBody, sign(appSecret, rawBody))).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    expect(verifyWebhookSignature(appSecret, rawBody, sign("wrong-secret", rawBody))).toBe(false);
  });

  it("rejects a signature that doesn't match a tampered body", () => {
    const signatureForOriginal = sign(appSecret, rawBody);
    expect(verifyWebhookSignature(appSecret, JSON.stringify({ entry: ["tampered"] }), signatureForOriginal)).toBe(
      false
    );
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(appSecret, rawBody, null)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const raw = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    expect(verifyWebhookSignature(appSecret, rawBody, raw)).toBe(false);
  });

  it("rejects a malformed/truncated signature without throwing", () => {
    expect(verifyWebhookSignature(appSecret, rawBody, "sha256=not-hex-and-too-short")).toBe(false);
  });
});
