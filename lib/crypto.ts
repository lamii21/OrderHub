import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { requireEnv } from "@/lib/env";

// AES-256-GCM, Node's built-in crypto only — no new dependency. Used to
// encrypt the Google OAuth refresh token at rest in google_accounts
// (lib/google-oauth.ts). Same "no new infrastructure by default" posture as
// lib/logger.ts.
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function requireEncryptionKey(): Buffer {
  const key = Buffer.from(requireEnv("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY"), "base64");

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`
    );
  }

  return key;
}

// iv(12) + authTag(16) + ciphertext, packed into one base64 string — no
// delimiter to parse, just fixed-offset slicing on decrypt.
export function encrypt(plaintext: string): string {
  const key = requireEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

// A tampered or corrupt payload throws naturally (GCM auth-tag mismatch) —
// callers treat that as "connection broken, ask the user to reconnect,"
// never swallow it silently.
export function decrypt(payload: string): string {
  const key = requireEncryptionKey();
  const raw = Buffer.from(payload, "base64");

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Reused by lib/google-oauth.ts to sign the OAuth "state" param — keeps one
// operator-managed secret instead of asking for a second env var just for
// state-signing.
export function deriveHmacKey(): Buffer {
  return createHash("sha256").update(requireEncryptionKey()).update("state-hmac").digest();
}
