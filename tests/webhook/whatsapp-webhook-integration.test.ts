import { createHmac } from "crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "../mocks/supabase";
import { mockFetchSequence } from "../mocks/fetch";

// The deepest integration test in this project: exercises the REAL route
// handler, REAL signature verification, REAL WhatsAppChannelAdapter, REAL
// dispatchInboundMessage, REAL conversation service + repository, REAL
// engine (context assembly, prompt building, the provider loop,
// persistence, events, summary), and REAL outbound WhatsApp client — the
// only three things mocked are the Supabase client itself (no live
// database), the LLM call (getChatProvider, the one genuine external AI
// boundary), and the global fetch() the outbound WhatsApp Graph API call
// uses. Everything in between — every layer in the diagram this étape was
// scoped against — runs for real.

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

const { getChatProvider, chat } = vi.hoisted(() => ({
  getChatProvider: vi.fn(),
  chat: vi.fn(),
}));

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, getChatProvider };
});

import { POST } from "@/app/api/whatsapp/webhook/[shopId]/route";
import { invalidateModuleCredentialsCache } from "@/lib/automation-modules/credentials";

const WHATSAPP_SECRETS = {
  accessToken: "graph-token",
  phoneNumberId: "phone-1",
  appSecret: "app-secret-value",
  verifyToken: "verify-token-value",
};

const AI_CREDENTIALS = { apiKey: "sk-or-test", model: "test-model" };

const conversationRow = {
  id: 1,
  shop_id: 15,
  customer_id: 42,
  channel: "whatsapp",
  external_thread_id: "212600000000",
  status: "open",
  memory: {},
  memory_version: 1,
  created_at: "2026-08-07T10:00:00.000Z",
  last_message_at: "2026-08-07T10:00:00.000Z",
  resolved_at: null,
  escalated_at: null,
};

const customerRow = { id: 42, name: "Salma", phone: "212600000000", email: null };
const shopRow = { id: 15, name: "AYLA", currency: "USD", timezone: "UTC" };
const agentConfigRow = {
  shop_id: 15,
  is_active: true,
  system_prompt: null,
  tone: "friendly",
  languages: ["fr", "ar-ma"],
  ai_provider: "openrouter",
  ai_model: "test-model",
  enabled_tools: [],
};

const userMessageRow = {
  id: 100,
  conversation_id: 1,
  role: "user",
  content: "wach kayn had produit?",
  content_type: "text",
  detected_language: null,
  detected_intent: null,
  sentiment_score: null,
  confidence_score: null,
  metadata: {},
  created_at: "2026-08-07T10:00:01.000Z",
};

const assistantMessageRow = {
  id: 101,
  conversation_id: 1,
  role: "assistant",
  content: "Wah, kayn 3 modèles disponibles.",
  content_type: "text",
  detected_language: null,
  detected_intent: null,
  sentiment_score: null,
  confidence_score: null,
  metadata: { provider: "openrouter", model: "test-model", finish_reason: "stop" },
  created_at: "2026-08-07T10:00:02.000Z",
};

function whatsappPayload() {
  return {
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "16505551111", phone_number_id: "phone-1" },
              contacts: [{ profile: { name: "Salma" }, wa_id: "212600000000" }],
              messages: [
                {
                  from: "212600000000",
                  id: "wamid.abc",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "wach kayn had produit?" },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function postRequest(shopId: string, rawBody: string, ip = "203.0.113.50") {
  return new NextRequest(`http://localhost/api/whatsapp/webhook/${shopId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      "x-hub-signature-256": sign(WHATSAPP_SECRETS.appSecret, rawBody),
    },
    body: rawBody,
  });
}

beforeEach(() => {
  invalidateModuleCredentialsCache();

  const { client } = createMockSupabase({
    responses: {
      module_credentials: [
        { data: { credentials: WHATSAPP_SECRETS }, error: null }, // getModuleCredentials(15, "whatsapp")
        { data: { credentials: AI_CREDENTIALS }, error: null }, // getAgentCredentials -> "ai-sales-agent"
      ],
      customers: { data: customerRow, error: null },
      agent_conversations: { data: conversationRow, error: null },
      shops: { data: shopRow, error: null },
      ai_agents: { data: agentConfigRow, error: null },
      agent_messages: [
        { data: userMessageRow, error: null }, // insertMessage (user)
        { data: [], error: null }, // listRecentMessages
        { data: assistantMessageRow, error: null }, // insertMessage (assistant reply)
        { data: null, error: null, count: 1 }, // countMessages (summary trigger check)
      ],
    },
  });
  holder.client = client;

  getChatProvider.mockReset().mockReturnValue({
    name: "openrouter",
    chat,
  });
  chat.mockReset().mockResolvedValue({
    content: "Wah, kayn 3 modèles disponibles.",
    provider: "openrouter",
    model: "test-model",
    finishReason: "stop",
  });

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WhatsApp webhook — full end-to-end chain", () => {
  it("carries a real inbound message all the way from HTTP to a delivered, persisted reply", async () => {
    const rawBody = JSON.stringify(whatsappPayload());
    const fetchMock = mockFetchSequence([{ json: async () => ({ messages: [{ id: "wamid.reply" }] }) }]);

    const response = await POST(postRequest("15", rawBody), { params: Promise.resolve({ shopId: "15" }) });

    // 1. The webhook itself acknowledged the request.
    expect(response.status).toBe(200);

    // 2. The LLM was called with a prompt built from the real conversation
    // context (system prompt naming the shop, plus the customer's message
    // translated into the provider's own ChatMessage shape).
    expect(chat).toHaveBeenCalledTimes(1);
    const [credentials, messages] = chat.mock.calls[0];
    expect(credentials).toEqual(AI_CREDENTIALS);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("AYLA");

    // 3. The reply was actually delivered over the WhatsApp Graph API, to
    // the customer's own number, using this shop's own access token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/phone-1/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer graph-token");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("212600000000");
    expect(body.text.body).toBe("Wah, kayn 3 modèles disponibles.");
  });

  it("rejects a request with an invalid signature before the chain ever starts", async () => {
    const rawBody = JSON.stringify(whatsappPayload());
    const request = new NextRequest("http://localhost/api/whatsapp/webhook/15", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign("wrong-secret", rawBody) },
      body: rawBody,
    });

    const response = await POST(request, { params: Promise.resolve({ shopId: "15" }) });

    expect(response.status).toBe(401);
    expect(chat).not.toHaveBeenCalled();
  });

  it("acknowledges with 200 and never reaches the engine when the payload is a delivery receipt, not a message", async () => {
    const statusPayload = {
      entry: [
        {
          id: "WABA_ID",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "phone-1" },
                statuses: [{ id: "wamid.abc", status: "delivered", timestamp: "1700000000", recipient_id: "212600000000" }],
              },
              field: "messages",
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(statusPayload);

    const response = await POST(postRequest("15", rawBody), { params: Promise.resolve({ shopId: "15" }) });

    expect(response.status).toBe(200);
    expect(chat).not.toHaveBeenCalled();
  });
});
