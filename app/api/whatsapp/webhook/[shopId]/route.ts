import { NextRequest, NextResponse } from "next/server";
import { getModuleCredentials } from "@/lib/automation-modules/credentials";
import { isWhatsAppWebhookSecrets, verifyWebhookChallenge, verifyWebhookSignature } from "@/lib/whatsapp-webhook";
import { dispatchInboundMessage } from "@/lib/agent/channels/dispatch";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// One webhook URL per shop (Phase 7 Étape 7.0's Option A) — shopId comes
// straight from the path, never resolved from the payload itself, so there
// is no phone_number_id -> shop_id lookup anywhere in this project. Each
// shop's own appSecret/verifyToken live in module_credentials alongside
// the accessToken/phoneNumberId the outbound automation module already
// uses (lib/automation-modules/whatsapp.ts) — same row, same module_name
// "whatsapp", extended with two more fields a merchant configures once.

function parseShopId(shopIdParam: string): number | null {
  const shopId = Number(shopIdParam);
  return Number.isInteger(shopId) && shopId > 0 ? shopId : null;
}

// Meta's one-time verification handshake, triggered when a merchant
// registers this URL in their Meta App dashboard. Never reaches
// dispatchInboundMessage — there is no message to process here.
export async function GET(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  const { shopId: shopIdParam } = await params;
  const shopId = parseShopId(shopIdParam);

  if (shopId === null) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const credentials = await getModuleCredentials(shopId, "whatsapp");
  if (!isWhatsAppWebhookSecrets(credentials)) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const challenge = verifyWebhookChallenge(credentials.verifyToken, {
    mode: request.nextUrl.searchParams.get("hub.mode"),
    token: request.nextUrl.searchParams.get("hub.verify_token"),
    challenge: request.nextUrl.searchParams.get("hub.challenge"),
  });

  if (challenge === null) {
    return new NextResponse("Forbidden.", { status: 403 });
  }

  return new NextResponse(challenge, { status: 200 });
}

// Every real inbound WhatsApp event lands here — new messages and
// delivery/read receipts alike (dispatchInboundMessage's own adapter
// already knows to ignore the latter). The raw body is read before any
// JSON parsing: verifyWebhookSignature needs the exact bytes Meta signed,
// not a reserialized copy that could differ in whitespace or key order.
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  const { shopId: shopIdParam } = await params;
  const shopId = parseShopId(shopIdParam);

  if (shopId === null) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const rateLimit = checkRateLimit(`whatsapp-webhook:${shopId}:${getClientIp(request.headers)}`, {
    max: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    logger.warn("whatsapp_webhook.rate_limited", { shopId });
    return new NextResponse("Too many requests.", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000)) },
    });
  }

  const credentials = await getModuleCredentials(shopId, "whatsapp");
  if (!isWhatsAppWebhookSecrets(credentials)) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(credentials.appSecret, rawBody, signature)) {
    logger.warn("whatsapp_webhook.invalid_signature", { shopId });
    return new NextResponse("Invalid signature.", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON.", { status: 400 });
  }

  try {
    await dispatchInboundMessage({ shopId, channel: "whatsapp", rawPayload: payload });
  } catch (err) {
    // dispatchInboundMessage only ever throws for a coding-level mistake
    // (an unregistered channel) — this route always calls it with the
    // hardcoded, known "whatsapp" channel, so reaching this catch means a
    // real bug, not a runtime condition. Logged, never surfaced as a 5xx:
    // a 5xx would trigger Meta's own retry, which would just hit the exact
    // same bug again.
    logger.error("whatsapp_webhook.dispatch_failed", { shopId, error: String(err) });
  }

  return new NextResponse("OK", { status: 200 });
}
