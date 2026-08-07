import { createHmac } from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getModuleCredentials, dispatchInboundMessage } = vi.hoisted(() => ({
  getModuleCredentials: vi.fn(),
  dispatchInboundMessage: vi.fn(),
}));

vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));
vi.mock("@/lib/agent/channels/dispatch", () => ({ dispatchInboundMessage }));

import { GET, POST } from "@/app/api/whatsapp/webhook/[shopId]/route";

const secrets = { appSecret: "app-secret-value", verifyToken: "verify-token-value", accessToken: "a", phoneNumberId: "p" };

function params(shopId: string) {
  return { params: Promise.resolve({ shopId }) };
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function postRequest(body: string, signature: string | null, ip = "203.0.113.1") {
  return new NextRequest("http://localhost/api/whatsapp/webhook/15", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(signature !== null && { "x-hub-signature-256": signature }),
    },
    body,
  });
}

beforeEach(() => {
  getModuleCredentials.mockReset().mockResolvedValue(secrets);
  dispatchInboundMessage.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/whatsapp/webhook/[shopId]", () => {
  function verifyRequest(query: string) {
    return new NextRequest(`http://localhost/api/whatsapp/webhook/15${query}`);
  }

  it("echoes hub.challenge back when mode and token match this shop's configured verifyToken", async () => {
    const response = await GET(
      verifyRequest("?hub.mode=subscribe&hub.verify_token=verify-token-value&hub.challenge=12345"),
      params("15")
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("12345");
  });

  it("returns 403 when the verify token doesn't match", async () => {
    const response = await GET(
      verifyRequest("?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345"),
      params("15")
    );
    expect(response.status).toBe(403);
  });

  it("returns 404 for a shop with no WhatsApp webhook secrets configured", async () => {
    getModuleCredentials.mockResolvedValue(null);

    const response = await GET(
      verifyRequest("?hub.mode=subscribe&hub.verify_token=verify-token-value&hub.challenge=12345"),
      params("15")
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 for a non-numeric shopId, without ever querying credentials", async () => {
    const response = await GET(verifyRequest("?hub.mode=subscribe"), params("not-a-number"));
    expect(response.status).toBe(404);
    expect(getModuleCredentials).not.toHaveBeenCalled();
  });
});

describe("POST /api/whatsapp/webhook/[shopId]", () => {
  const rawBody = JSON.stringify({ entry: [{ id: "WABA", changes: [] }] });

  it("verifies the signature, dispatches the payload, and acknowledges with 200", async () => {
    const response = await POST(postRequest(rawBody, sign("app-secret-value", rawBody)), params("15"));

    expect(response.status).toBe(200);
    expect(dispatchInboundMessage).toHaveBeenCalledWith({
      shopId: 15,
      channel: "whatsapp",
      rawPayload: JSON.parse(rawBody),
    });
  });

  it("rejects an invalid signature with 401, without ever dispatching", async () => {
    const response = await POST(postRequest(rawBody, sign("wrong-secret", rawBody)), params("15"));

    expect(response.status).toBe(401);
    expect(dispatchInboundMessage).not.toHaveBeenCalled();
  });

  it("rejects a missing signature header with 401", async () => {
    const response = await POST(postRequest(rawBody, null), params("15"));
    expect(response.status).toBe(401);
  });

  it("returns 404 for a shop with no WhatsApp webhook secrets configured, without checking the signature", async () => {
    getModuleCredentials.mockResolvedValue(null);

    const response = await POST(postRequest(rawBody, sign("app-secret-value", rawBody)), params("15"));

    expect(response.status).toBe(404);
    expect(dispatchInboundMessage).not.toHaveBeenCalled();
  });

  it("returns 400 for a validly signed but malformed JSON body", async () => {
    const malformed = "{not json";
    const response = await POST(postRequest(malformed, sign("app-secret-value", malformed)), params("15"));

    expect(response.status).toBe(400);
    expect(dispatchInboundMessage).not.toHaveBeenCalled();
  });

  it("still responds 200 even when dispatchInboundMessage itself throws, so Meta never retries", async () => {
    dispatchInboundMessage.mockRejectedValue(new Error('No channel adapter registered for "whatsapp"'));

    const response = await POST(postRequest(rawBody, sign("app-secret-value", rawBody)), params("15"));

    expect(response.status).toBe(200);
  });

  it("rate-limits repeated requests from the same shop and IP", async () => {
    const ip = "198.51.100.30";
    let lastResponse;
    for (let i = 0; i < 121; i++) {
      lastResponse = await POST(postRequest(rawBody, sign("app-secret-value", rawBody), ip), params("15"));
    }

    expect(lastResponse!.status).toBe(429);
  });
});
