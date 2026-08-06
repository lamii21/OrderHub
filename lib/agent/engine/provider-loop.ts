import { getChatProvider, type ChatMessage, type ChatOptions, type ChatResult } from "@/lib/ai";
import { getEnabledTools } from "../tools/registry";
import { dispatchToolCall } from "../tools/dispatch";
import type { AgentToolCall } from "../types";
import type { AgentExecutionContext } from "./types";

// Bounded, not unlimited — a model that keeps requesting tools (its own
// bug, a confused loop, an adversarial input) must not hang a request
// forever. Same posture as memory/conversation-memory.ts's
// MAX_MEMORY_UPDATE_ATTEMPTS: a named constant, not a magic number, and a
// thrown error rather than silently returning a truncated/wrong answer
// once exhausted.
export const MAX_TOOL_ROUNDTRIPS = 5;

export type ProviderLoopResult = {
  result: ChatResult;
  toolCalls: AgentToolCall[];
};

// Owns the "LLM -> Tool Dispatcher -> Tool Result -> LLM" cycle end to
// end, so engine/execute.ts's own callProvider stays the one-line
// delegation the Phase 5 review asked for once this loop grew past a
// couple of lines. A turn with no tool calls at all (today's only real
// case, since the tool registry starts empty) resolves on the very first
// iteration, identical to Étape 4's original single-call behavior.
export async function runProviderLoop(
  context: AgentExecutionContext,
  initialMessages: ChatMessage[]
): Promise<ProviderLoopResult> {
  const provider = getChatProvider(context.agent_config.ai_provider);
  const tools = getEnabledTools(context.agent_config.enabled_tools);

  const chatOptions: ChatOptions = {};
  if (context.options.temperature !== undefined) {
    chatOptions.temperature = context.options.temperature;
  }
  if (tools.length > 0) {
    chatOptions.tools = tools;
  }

  const toolExecutionContext = {
    shop_id: context.conversation_context.shop.id,
    conversation_id: context.conversation_context.conversation.id,
    // Already loaded as part of the conversation itself (Phase 4) — no
    // extra read needed to resolve "which customer" for every tool call
    // this turn makes.
    customer_id: context.conversation_context.conversation.customer_id,
  };

  let messages = initialMessages;
  const allToolCalls: AgentToolCall[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDTRIPS; round++) {
    const result = await provider.chat(context.credentials, messages, chatOptions);

    if (result.finishReason !== "tool_calls" || !result.toolCalls || result.toolCalls.length === 0) {
      return { result, toolCalls: allToolCalls };
    }

    const dispatched = await Promise.all(
      result.toolCalls.map((call) => dispatchToolCall(call, toolExecutionContext))
    );
    allToolCalls.push(...dispatched);

    // Replays the assistant's own tool-call request back into the history
    // (content defaults to "" — ChatMessage.content is never null, unlike
    // ChatResult.content — a tool-calling turn typically has no text of its
    // own) followed by one "tool" role message per dispatched call, success
    // or failure alike: the model reacts to a failed call the same way it
    // would react to any other tool result, via dispatchToolCall's own
    // never-throws contract.
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: result.content ?? "",
      toolCalls: result.toolCalls,
    };

    const toolResultMessages: ChatMessage[] = dispatched.map((call) => ({
      role: "tool",
      content: JSON.stringify(call.status === "succeeded" ? call.result : { error: call.error }),
      toolCallId: call.id,
    }));

    messages = [...messages, assistantMessage, ...toolResultMessages];
  }

  throw new Error(
    `Tool calling exceeded ${MAX_TOOL_ROUNDTRIPS} round-trips for conversation ${context.conversation_context.conversation.id}.`
  );
}
