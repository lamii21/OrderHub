import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../../mocks/supabase";

// Unlike provider-loop.test.ts (which mocks tools/registry and
// tools/dispatch to test the loop's own orchestration in isolation), this
// file mocks nothing above the Supabase client and the LLM call itself —
// tools/registry.ts, tools/dispatch.ts, and all three shipped tools
// (orders, products, promo-codes: repository -> service -> tool) run for
// real. This is the safety net Étape 6.5 was for: it would catch a tool
// registered under the wrong name, a malformed parameters schema, or a
// wiring mistake between dispatch.ts and the real registry — none of which
// any single tool's own isolated unit tests could ever see.

const { getChatProvider, chat } = vi.hoisted(() => ({
  getChatProvider: vi.fn(),
  chat: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ getChatProvider }));

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { runProviderLoop } from "@/lib/agent/engine/provider-loop";
import { getTool, getEnabledTools } from "@/lib/agent/tools/registry";
import type { AgentExecutionContext } from "@/lib/agent/engine/types";

const context: AgentExecutionContext = {
  conversation_context: {
    shop: { id: 15, name: "AYLA", currency: "USD", timezone: "UTC" },
    customer: { id: 42, name: "Salma", phone: "212600000000", email: null },
    conversation: {
      id: 1,
      shop_id: 15,
      customer_id: 42,
      channel: "whatsapp",
      external_thread_id: "212600000000",
      status: "open",
      memory: { version: 1 },
      created_at: "2026-08-06T10:00:00.000Z",
      last_message_at: "2026-08-06T10:00:00.000Z",
      resolved_at: null,
      escalated_at: null,
    },
    recent_messages: [],
  },
  agent_config: {
    shop_id: 15,
    is_active: true,
    system_prompt: null,
    tone: "friendly",
    languages: ["fr", "ar-ma"],
    ai_provider: "openrouter",
    ai_model: "test-model",
    enabled_tools: ["get_order_status", "search_products", "check_promo_code"],
    rag_enabled: false,
    rag_top_k: null,
  },
  credentials: { apiKey: "sk-or-test", model: "test-model" },
  options: {},
  retrieved_context: [],
};

const initialMessages = [{ role: "system" as const, content: "system prompt" }];

const orderRow = {
  order_id: "ORD-1001",
  product: "Veste en jean",
  quantity: 1,
  price: 350,
  status: "shipped",
  created_at: "2026-08-06T09:00:00.000Z",
};

const productRow = {
  name: "Veste en jean",
  price: 350,
  stock_quantity: 12,
  product_variants: [{ title: "Bleu / M", price: 350, stock_quantity: 3 }],
};

const promoCodeRow = {
  discount_type: "percentage",
  discount_value: 10,
  expires_at: null,
};

const finalResult = {
  content: "Voici les informations demandées.",
  provider: "openrouter",
  model: "test-model",
  finishReason: "stop" as const,
};

beforeEach(() => {
  const { client } = createMockSupabase({
    responses: {
      orders: { data: orderRow, error: null },
      products: { data: [productRow], error: null },
      promo_codes: { data: promoCodeRow, error: null },
    },
  });
  holder.client = client;

  getChatProvider.mockReset().mockReturnValue({ name: "openrouter", chat });
  chat.mockReset();
});

describe("runProviderLoop — real registry integration", () => {
  it("advertises the shop's three enabled tools with their real ChatTool schemas", async () => {
    chat.mockResolvedValueOnce(finalResult);

    await runProviderLoop(context, initialMessages);

    const chatOptions = chat.mock.calls[0][2];
    expect(chatOptions.tools).toEqual(getEnabledTools(context.agent_config.enabled_tools));
    expect(chatOptions.tools.map((t: { name: string }) => t.name)).toEqual([
      "get_order_status",
      "search_products",
      "check_promo_code",
    ]);
  });

  it("dispatches all three real tools in one round-trip and feeds real DB-backed results back to the model", async () => {
    chat
      .mockResolvedValueOnce({
        content: null,
        provider: "openrouter",
        model: "test-model",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "call_1", name: "get_order_status", arguments: {} },
          { id: "call_2", name: "search_products", arguments: { query: "veste" } },
          { id: "call_3", name: "check_promo_code", arguments: { code: "WELCOME10" } },
        ],
      })
      .mockResolvedValueOnce(finalResult);

    const { result, toolCalls } = await runProviderLoop(context, initialMessages);

    expect(result).toEqual(finalResult);
    expect(toolCalls).toHaveLength(3);
    expect(toolCalls.every((call) => call.status === "succeeded")).toBe(true);

    const byName: Record<string, unknown> = Object.fromEntries(toolCalls.map((call) => [call.name, call.result]));
    expect(byName["get_order_status"]).toEqual({
      found: true,
      order: {
        order_id: "ORD-1001",
        product: "Veste en jean",
        quantity: 1,
        price: 350,
        status: "shipped",
        created_at: "2026-08-06T09:00:00.000Z",
      },
    });
    expect(byName["search_products"]).toEqual({
      products: [
        {
          name: "Veste en jean",
          price: 350,
          availability: "in_stock",
          variants: [{ title: "Bleu / M", price: 350, availability: "low_stock" }],
        },
      ],
    });
    expect(byName["check_promo_code"]).toEqual({ valid: true, discount_type: "percentage", discount_value: 10 });

    // The second call to the provider must replay all three tool results,
    // each tagged with the tool_call_id the model itself issued.
    const secondCallMessages = chat.mock.calls[1][1];
    const toolResultMessages = secondCallMessages.slice(initialMessages.length + 1);
    expect(toolResultMessages.map((m: { toolCallId: string }) => m.toolCallId)).toEqual([
      "call_1",
      "call_2",
      "call_3",
    ]);
  });

  it("still resolves cleanly when a real tool declines to answer (no customer identified)", async () => {
    const contextWithoutCustomer: AgentExecutionContext = {
      ...context,
      conversation_context: {
        ...context.conversation_context,
        conversation: { ...context.conversation_context.conversation, customer_id: null },
      },
    };
    chat
      .mockResolvedValueOnce({
        content: null,
        provider: "openrouter",
        model: "test-model",
        finishReason: "tool_calls",
        toolCalls: [{ id: "call_1", name: "get_order_status", arguments: {} }],
      })
      .mockResolvedValueOnce(finalResult);

    const { toolCalls } = await runProviderLoop(contextWithoutCustomer, initialMessages);

    expect(toolCalls[0].status).toBe("succeeded");
    expect(toolCalls[0].result).toEqual({ found: false, reason: "no_customer_identified" });
  });

  it("every tool registered under a given key declares that same name — catches a copy-paste mismatch", () => {
    for (const key of ["get_order_status", "search_products", "check_promo_code"] as const) {
      expect(getTool(key)?.name).toBe(key);
    }
  });

  it("every advertised tool's parameters schema is a well-formed JSON Schema object", () => {
    for (const tool of getEnabledTools(context.agent_config.enabled_tools)) {
      expect(tool.parameters).toMatchObject({ type: "object", properties: expect.any(Object) });
    }
  });
});
