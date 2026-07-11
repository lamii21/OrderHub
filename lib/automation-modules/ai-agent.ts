import { getModuleCredentials } from "./credentials";
import { fetchWithTimeout, isTimeoutError } from "./http";
import type { AutomationModule } from "./types";
import type { Order } from "@/types/order";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 500;

type AiAgentConfig = { task: string; confidenceThreshold?: number };
// model is a required credential, not a hard-coded constant here — model
// ids change faster than this module's code should, and picking one on the
// merchant's behalf risks silently going stale. Same reasoning as SMS
// requiring its own fromNumber rather than this module guessing one.
type AiAgentCredentials = { apiKey: string; model: string };

function isAiAgentCredentials(value: Record<string, unknown> | null): value is AiAgentCredentials {
  return !!value && typeof value.apiKey === "string" && typeof value.model === "string";
}

// Claude is asked to answer in strict JSON so `data.result` is something a
// later step (Tag Order, Condition) can actually consume, and so
// `confidenceThreshold` — a real field on this config since before this
// module had any implementation — has something to compare against.
function buildPrompt(task: string, order: Order): string {
  const context = {
    order_id: order.order_id ?? order.id,
    customer_name: order.customer_name,
    customer_city: order.customer_city,
    product: order.product,
    quantity: order.quantity,
    price: order.price,
    status: order.status,
    tags: order.tags,
    platform: order.shops?.platform ?? null,
  };

  return (
    `Task: ${task}\n\n` +
    `Order data (JSON): ${JSON.stringify(context)}\n\n` +
    'Respond with ONLY a JSON object of the exact shape {"result": string, "confidence": number} ' +
    "— result is your answer to the task, confidence is your confidence in that answer from 0 to 1. " +
    "No other text."
  );
}

// Anthropic wraps the model's reply in a content-block array; a text
// response is exactly one block of type "text" for a plain single-turn
// prompt like this one. Tolerates the model wrapping its JSON in prose or
// a code fence (both observed in practice) by extracting the first
// {...} span instead of requiring the whole response to be valid JSON.
function parseAgentReply(text: string): { result: string; confidence: number | null } {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { result?: unknown; confidence?: unknown };
      if (typeof parsed.result === "string") {
        return {
          result: parsed.result,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
        };
      }
    } catch {
      // Falls through to the raw-text fallback below.
    }
  }

  return { result: text.trim(), confidence: null };
}

export const aiAgentModule: AutomationModule = {
  validateConfig(config) {
    const { task, confidenceThreshold } = config as Partial<AiAgentConfig>;

    if (typeof task !== "string" || task.trim() === "") {
      return "AI Agent requires a non-empty task description.";
    }

    if (
      confidenceThreshold !== undefined &&
      (typeof confidenceThreshold !== "number" || confidenceThreshold < 0 || confidenceThreshold > 1)
    ) {
      return "AI Agent's confidence threshold must be a number between 0 and 1.";
    }

    return null;
  },

  async run(order, config) {
    const { task, confidenceThreshold } = config as AiAgentConfig;

    if (!order.shop_id) {
      return { success: false, message: "Order has no associated shop." };
    }

    const credentials = await getModuleCredentials(order.shop_id, "ai-agent");
    if (!isAiAgentCredentials(credentials)) {
      return { success: false, message: "AI Agent is not configured for this shop." };
    }

    try {
      const response = await fetchWithTimeout(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": credentials.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: credentials.model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: "user", content: buildPrompt(task, order) }],
        }),
      });

      if (!response.ok) {
        return { success: false, message: `AI Agent request failed (HTTP ${response.status}).` };
      }

      const body = (await response.json()) as { content?: { type: string; text?: string }[] };
      const text = body.content?.find((block) => block.type === "text")?.text;

      if (!text) {
        return { success: false, message: "AI Agent returned no text response." };
      }

      const { result, confidence } = parseAgentReply(text);

      if (
        confidenceThreshold !== undefined &&
        confidence !== null &&
        confidence < confidenceThreshold
      ) {
        return {
          success: true,
          outcome: "stop",
          message: `AI Agent confidence ${confidence} is below the required threshold ${confidenceThreshold} — workflow stopped.`,
          data: { result, confidence },
        };
      }

      return {
        success: true,
        message: "AI Agent completed.",
        data: confidence !== null ? { result, confidence } : { result },
      };
    } catch (err) {
      console.error("aiAgentModule: request failed:", err);
      return {
        success: false,
        message: isTimeoutError(err)
          ? "AI Agent request timed out."
          : "AI Agent request failed (network error).",
      };
    }
  },
};
