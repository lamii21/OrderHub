import {
  AiAuthenticationError,
  AiProviderError,
  AiRateLimitError,
  AiTimeoutError,
  AiValidationError,
} from "../errors";
import { buildAbortSignal } from "../http";
import type {
  AiCredentials,
  ChatFinishReason,
  ChatMessage,
  ChatOptions,
  ChatProvider,
  ChatResult,
  ChatToolCall,
  ChatTool,
} from "../types";

// UNVERIFIED AGAINST A LIVE OPENROUTER ACCOUNT — built against OpenRouter's
// published API reference (an OpenAI-compatible chat completions shape),
// never actually exercised against a real key in this session. Same
// disclosure precedent as lib/platforms/youcan.ts and
// lib/automation-modules/payment-link.ts elsewhere in this project.
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Longer than the 10-15s timeouts used elsewhere in this project
// (lib/automation-modules/http.ts, lib/platforms/retry.ts) — those call
// REST APIs that respond quickly; an LLM completion genuinely takes longer
// to generate, especially free-tier models under load.
const TIMEOUT_MS = 30_000;

const PROVIDER_NAME = "openrouter";

type OpenRouterMessage = {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
};

type OpenRouterTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type OpenRouterRequestBody = {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: OpenRouterTool[];
  response_format?: { type: "json_object" };
};

type OpenRouterToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

type OpenRouterResponse = {
  model?: string;
  choices?: {
    message?: { content?: string | null; tool_calls?: OpenRouterToolCall[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

// finish_reason is a plain string on the wire, with no guarantee OpenRouter
// (or the free model behind it) only ever sends the 4 values this project
// models explicitly — an unrecognized one becomes "unknown" rather than a
// thrown error or a raw string the caller has to defensively handle itself.
function mapFinishReason(raw: string | null | undefined): ChatFinishReason {
  switch (raw) {
    case "stop":
    case "length":
    case "tool_calls":
    case "content_filter":
      return raw;
    default:
      return "unknown";
  }
}

function toOpenRouterTool(tool: ChatTool): OpenRouterTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

// The outgoing mirror of parseToolCallArguments below: OpenRouter (like the
// OpenAI-compatible providers it fronts) expects a requested call's
// arguments serialized back to a JSON *string* on the way out, the same
// shape it sent them as a string on the way in.
function toOpenRouterToolCall(call: ChatToolCall): { id: string; type: "function"; function: { name: string; arguments: string } } {
  return { id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
}

// OpenRouter (like the underlying OpenAI-compatible providers it fronts)
// returns tool call arguments as a JSON *string*, not a parsed object —
// tolerated leniently rather than letting a malformed string from a
// free-tier model crash the whole request, same "never trust an external
// model's formatting" posture as
// lib/automation-modules/ai-agent.ts's own parseAgentReply().
function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function chat(
  credentials: AiCredentials,
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<ChatResult> {
  const model = options?.model ?? credentials.model;

  const requestBody: OpenRouterRequestBody = {
    model,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.toolCalls && message.toolCalls.length > 0
        ? { tool_calls: message.toolCalls.map(toOpenRouterToolCall) }
        : {}),
    })),
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    ...(options?.tools ? { tools: options.tools.map(toOpenRouterTool) } : {}),
    ...(options?.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
  };

  const { signal, clear } = buildAbortSignal(TIMEOUT_MS, options?.abortSignal);
  let response: Response;

  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (err) {
    // Fires for either source of abort (our own timeout, or the caller's
    // own abortSignal firing first) — both are reported the same way,
    // since fetch's AbortError carries no information about which signal
    // in the combination actually triggered it.
    if (err instanceof Error && err.name === "AbortError") {
      throw new AiTimeoutError(PROVIDER_NAME, TIMEOUT_MS);
    }
    throw new AiProviderError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      PROVIDER_NAME,
      { cause: err }
    );
  } finally {
    clear();
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AiAuthenticationError(PROVIDER_NAME);
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new AiRateLimitError(PROVIDER_NAME, retryAfter ? Number(retryAfter) : undefined);
    }

    if (response.status === 400 || response.status === 422) {
      const bodyText = await response.text().catch(() => "");
      throw new AiValidationError(
        PROVIDER_NAME,
        `request rejected (HTTP ${response.status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`
      );
    }

    throw new AiProviderError(`request failed (HTTP ${response.status})`, PROVIDER_NAME);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const choice = data.choices?.[0];
  const message = choice?.message;

  const toolCalls: ChatToolCall[] | undefined = message?.tool_calls?.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: parseToolCallArguments(toolCall.function.arguments),
  }));

  return {
    content: message?.content ?? null,
    provider: PROVIDER_NAME,
    // Falls back to the requested model only if OpenRouter's response
    // omits its own `model` field — see ChatResult.model's own comment on
    // why the two can legitimately differ.
    model: data.model ?? model,
    finishReason: mapFinishReason(choice?.finish_reason),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(data.usage
      ? {
          usage: {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          },
        }
      : {}),
  };
}

export const openrouterProvider: ChatProvider = {
  name: PROVIDER_NAME,
  // Describes the request *shape* this code correctly produces — tools and
  // response_format are serialized onto every request when asked (covered
  // by tests/ai/providers/openrouter.test.ts) — not a guarantee that every
  // free model routed to behind OpenRouter honors them well. Streaming and
  // vision are genuinely unimplemented: chat() always returns a single
  // resolved Promise<ChatResult>, never a stream, and never sends image
  // content.
  capabilities: {
    chat: true,
    embeddings: false,
    tools: true,
    streaming: false,
    vision: false,
    jsonMode: true,
  },
  chat,
};
