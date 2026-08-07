import { createHmac, timingSafeEqual } from "crypto";

// The inbound half of WhatsApp integration — lib/whatsapp-client.ts is the
// outbound half (sending). Kept separate from app/api/whatsapp/webhook/
// [shopId]/route.ts (Étape 7.4) so the verification logic is testable
// without constructing a NextRequest, same "route.ts stays thin, lib/
// holds the logic" convention every other route in this project already
// follows (app/api/orders/route.ts, app/api/google/callback/route.ts).

// A shop's own webhook secrets, distinct from WhatsAppCredentials
// (accessToken/phoneNumberId, lib/whatsapp-client.ts) even though both live
// in the same module_credentials row under module_name "whatsapp" — these
// two guard different directions (receiving vs sending) and a shop
// configures all four fields together, but nothing here assumes the other
// pair is present, or vice versa.
export type WhatsAppWebhookSecrets = { appSecret: string; verifyToken: string };

export function isWhatsAppWebhookSecrets(value: Record<string, unknown> | null): value is WhatsAppWebhookSecrets {
  return !!value && typeof value.appSecret === "string" && typeof value.verifyToken === "string";
}

// Meta's one-time verification handshake (a GET request), sent when a
// merchant registers this shop's webhook URL in their Meta App dashboard.
// Returns the challenge to echo back only if the mode and token match
// exactly what this shop configured; null otherwise. Has no notion of HTTP
// status codes — the caller (the route handler) decides what a null means.
export function verifyWebhookChallenge(
  verifyToken: string,
  params: { mode: string | null; token: string | null; challenge: string | null }
): string | null {
  if (params.mode !== "subscribe" || params.token !== verifyToken || !params.challenge) {
    return null;
  }

  return params.challenge;
}

// Meta signs every webhook POST body with the shop's own app secret —
// verifying it is what proves a request actually came from Meta (or from
// someone who already knows the secret), not merely someone who discovered
// this shop's webhook URL. rawBody must be the exact bytes Meta sent
// (before any JSON.parse/reserialization, which could change whitespace or
// key order and break the signature) — the caller is responsible for
// reading request.text() before any request.json() call.
export function verifyWebhookSignature(appSecret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const provided = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"), "hex");

  // timingSafeEqual throws on mismatched buffer lengths rather than
  // returning false — checked explicitly first, since a malformed or
  // truncated header is exactly the kind of input a caller shouldn't be
  // able to use to crash this check.
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
