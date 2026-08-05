import { describe, it, expect, afterEach, vi } from "vitest";
import { openrouterProvider } from "@/lib/ai/providers/openrouter";
import {
  AiAuthenticationError,
  AiProviderError,
  AiRateLimitError,
  AiTimeoutError,
  AiValidationError,
} from "@/lib/ai/errors";
import { mockFetchSequence } from "../../mocks/fetch";
import type { ChatMessage } from "@/lib/ai/types";

const credentials = { apiKey: "sk-or-test", model: "meta-llama/llama-3.3-70b-instruct:free" };
const messages: ChatMessage[] = [{ role: "user", content: "wach kayn had produit?" }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openrouterProvider.capabilities", () => {
  it("declares chat/tools/jsonMode support and no embeddings/streaming/vision, matching what chat() actually does", () => {
    expect(openrouterProvider.capabilities).toEqual({
      chat: true,
      embeddings: false,
      tools: true,
      streaming: false,
      vision: false,
      jsonMode: true,
    });
  });
});

describe("openrouterProvider.chat — request shape", () => {
  it("sends the credentials' model, messages, and Bearer auth header", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "Wah, kayn!" } }] }) }]);

    await openrouterProvider.chat(credentials, messages);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(credentials.model);
    expect(body.messages).toEqual([{ role: "user", content: "wach kayn had produit?" }]);
  });

  it("options.model overrides credentials.model for this call only", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    await openrouterProvider.chat(credentials, messages, { model: "a-different-model" });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("a-different-model");
  });

  it("forwards temperature, maxTokens, tools, and responseFormat when provided", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    await openrouterProvider.chat(credentials, messages, {
      temperature: 0.7,
      maxTokens: 200,
      responseFormat: "json",
      tools: [{ name: "check_stock", description: "Check product stock", parameters: { type: "object" } }],
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(200);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.tools).toEqual([
      { type: "function", function: { name: "check_stock", description: "Check product stock", parameters: { type: "object" } } },
    ]);
  });

  it("omits optional fields entirely when not provided, rather than sending them as undefined/null", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    await openrouterProvider.chat(credentials, messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("response_format");
  });

  it("includes tool_call_id only on messages that carry one", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    await openrouterProvider.chat(credentials, [
      { role: "assistant", content: "checking stock..." },
      { role: "tool", content: "12 in stock", toolCallId: "call_1" },
    ]);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0]).not.toHaveProperty("tool_call_id");
    expect(body.messages[1].tool_call_id).toBe("call_1");
  });

  it("serializes an assistant message's toolCalls back into the request, arguments re-encoded as a JSON string", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    await openrouterProvider.chat(credentials, [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "check_stock", arguments: { productId: 42 } }],
      },
      { role: "tool", content: "12 in stock", toolCallId: "call_1" },
    ]);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "check_stock", arguments: '{"productId":42}' } },
    ]);
  });

  it("omits tool_calls entirely on a message that didn't request any", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    await openrouterProvider.chat(credentials, messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0]).not.toHaveProperty("tool_calls");
  });
});

describe("openrouterProvider.chat — response parsing", () => {
  it("returns the message content and the model that actually answered", async () => {
    mockFetchSequence([
      { json: async () => ({ model: "meta-llama/llama-3.3-70b-instruct:free", choices: [{ message: { content: "Wah, kayn!" } }] }) },
    ]);

    const result = await openrouterProvider.chat(credentials, messages);

    expect(result.content).toBe("Wah, kayn!");
    expect(result.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });

  it("falls back to the requested model when the response omits its own model field", async () => {
    mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    const result = await openrouterProvider.chat(credentials, messages);

    expect(result.model).toBe(credentials.model);
  });

  it("stamps its own provider name on every result", async () => {
    mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    const result = await openrouterProvider.chat(credentials, messages);

    expect(result.provider).toBe("openrouter");
  });

  it.each([
    ["stop", "stop"],
    ["length", "length"],
    ["tool_calls", "tool_calls"],
    ["content_filter", "content_filter"],
    ["something_a_future_model_invents", "unknown"],
    [null, "unknown"],
    [undefined, "unknown"],
  ])("maps raw finish_reason %s to %s", async (raw, expected) => {
    mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: raw }] }) }]);

    const result = await openrouterProvider.chat(credentials, messages);

    expect(result.finishReason).toBe(expected);
  });

  it("maps usage from snake_case to the normalized ChatUsage shape", async () => {
    mockFetchSequence([
      {
        json: async () => ({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
        }),
      },
    ]);

    const result = await openrouterProvider.chat(credentials, messages);

    expect(result.usage).toEqual({ promptTokens: 42, completionTokens: 18, totalTokens: 60 });
  });

  it("parses tool calls, decoding each one's JSON-string arguments into an object", async () => {
    mockFetchSequence([
      {
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: "call_1", function: { name: "check_stock", arguments: '{"productId":42}' } }],
              },
            },
          ],
        }),
      },
    ]);

    const result = await openrouterProvider.chat(credentials, messages, {
      tools: [{ name: "check_stock", description: "", parameters: {} }],
    });

    expect(result.content).toBeNull();
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "check_stock", arguments: { productId: 42 } }]);
  });

  it("falls back to an empty object when a tool call's arguments string is malformed JSON (never throws)", async () => {
    mockFetchSequence([
      {
        json: async () => ({
          choices: [{ message: { tool_calls: [{ id: "call_1", function: { name: "check_stock", arguments: "{not json" } }] } }],
        }),
      },
    ]);

    const result = await openrouterProvider.chat(credentials, messages);

    expect(result.toolCalls).toEqual([{ id: "call_1", name: "check_stock", arguments: {} }]);
  });

  it("omits toolCalls entirely when the response has none, rather than an empty array", async () => {
    mockFetchSequence([{ json: async () => ({ choices: [{ message: { content: "ok" } }] }) }]);

    const result = await openrouterProvider.chat(credentials, messages);

    expect(result.toolCalls).toBeUndefined();
  });
});

describe("openrouterProvider.chat — error mapping", () => {
  it("maps HTTP 401 to AiAuthenticationError", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);
    await expect(openrouterProvider.chat(credentials, messages)).rejects.toThrow(AiAuthenticationError);
  });

  it("maps HTTP 403 to AiAuthenticationError", async () => {
    mockFetchSequence([{ ok: false, status: 403 }]);
    await expect(openrouterProvider.chat(credentials, messages)).rejects.toThrow(AiAuthenticationError);
  });

  it("maps HTTP 429 to AiRateLimitError, carrying Retry-After when present", async () => {
    mockFetchSequence([{ ok: false, status: 429, headers: { "retry-after": "7" } }]);

    const error = await openrouterProvider.chat(credentials, messages).catch((err) => err);

    expect(error).toBeInstanceOf(AiRateLimitError);
    expect((error as AiRateLimitError).retryAfterSeconds).toBe(7);
  });

  it("maps HTTP 400 to AiValidationError", async () => {
    mockFetchSequence([{ ok: false, status: 400, text: async () => "invalid model id" }]);
    await expect(openrouterProvider.chat(credentials, messages)).rejects.toThrow(AiValidationError);
  });

  it("maps HTTP 422 to AiValidationError", async () => {
    mockFetchSequence([{ ok: false, status: 422 }]);
    await expect(openrouterProvider.chat(credentials, messages)).rejects.toThrow(AiValidationError);
  });

  it("maps any other non-2xx status to the generic AiProviderError", async () => {
    mockFetchSequence([{ ok: false, status: 503 }]);
    await expect(openrouterProvider.chat(credentials, messages)).rejects.toThrow(AiProviderError);
  });

  it("maps a request timeout (AbortError) to AiTimeoutError", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(openrouterProvider.chat(credentials, messages)).rejects.toThrow(AiTimeoutError);
  });

  it("wraps a plain network error in AiProviderError, preserving it as `cause`", async () => {
    const networkError = new Error("ECONNRESET");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    const error = await openrouterProvider.chat(credentials, messages).catch((err) => err);

    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).cause).toBe(networkError);
  });

  it("every mapped error carries the provider name", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);
    const error = await openrouterProvider.chat(credentials, messages).catch((err) => err);
    expect((error as AiAuthenticationError).provider).toBe("openrouter");
  });
});
