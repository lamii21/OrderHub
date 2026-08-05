import type { ChatResult } from "@/lib/ai";
import { assembleExecutionContext } from "../context/service";
import { buildPrompt } from "../prompt/builder";
import { appendMessage } from "../conversation/service";
import { emitAgentEvent } from "../events";
import { maybeSummarizeConversation } from "../summary/service";
import { runProviderLoop } from "./provider-loop";
import type { AgentEngineOptions, AgentExecutionContext, AgentRequest, AgentResponse } from "./types";
import type { AgentToolCall, MessageMetadata } from "../types";

// The engine's own top-level shape, named as a pipeline the way the Phase 5
// review asked for: loadContext -> ensureAgentCanRun -> buildPrompt ->
// runProviderLoop -> persistResponse -> publishEvents -> maybeSummarizeConversation.
// Each step below is a private wrapper even where (like loadContext) it
// does nothing beyond delegate today — the point is that
// executeConversation() itself stays readable as this list of names, not
// that every wrapper is doing complex work yet.
//
// The engine never imports a workflow, a notifier, or anything else that
// reacts to what it just did — it only calls emitAgentEvent() (the same bus
// conversation/service.ts already publishes to) and lets whatever is
// subscribed react. Nothing is subscribed yet; that bridge is a later
// phase's job, not this one's. maybeSummarizeConversation (lib/agent/summary/)
// is the one exception to "never call anything but a private wrapper" —
// it's still not a workflow or a notifier, just this conversation's own
// memory being kept current, which is why it lives inside lib/agent/ rather
// than being reached via an event subscriber.

async function loadContext(request: AgentRequest, options: AgentEngineOptions): Promise<AgentExecutionContext> {
  return assembleExecutionContext(request.conversation_id, options);
}

function ensureAgentCanRun(context: AgentExecutionContext): void {
  if (!context.agent_config.is_active) {
    throw new Error(`AI agent is not active for shop ${context.conversation_context.shop.id}.`);
  }
}

// Persists the assistant's reply through conversation/service.ts's
// appendMessage() — never repository.ts directly, same rule every other
// caller in this subsystem follows. chatResult.content is string | null
// (lib/ai/types.ts: a provider can finish with nothing to say); there is
// nothing meaningful to persist as a message body in that case, so this
// throws rather than writing an empty/placeholder row — runProviderLoop
// already resolves every "tool_calls" finish reason internally before
// returning, so a null content reaching here means the provider itself had
// nothing left to say, not an unhandled tool round-trip. latency_ms goes
// slightly beyond the literal metadata list (provider, model, usage,
// finishReason) — added because it's cheap to measure here and
// MessageMetadata already reserves the field for exactly this kind of
// observability; flagged here as a reasoned addition, not a silent one.
// toolCalls (Étape 8) is the full trail of any tool round-trips this turn
// took — attached to this one row rather than persisted as separate
// messages, a deliberate compromise: see provider-loop.ts's own comment on
// why, and the Étape 8 analysis this was validated against.
async function persistResponse(
  context: AgentExecutionContext,
  chatResult: ChatResult,
  latencyMs: number,
  toolCalls: AgentToolCall[]
): Promise<AgentResponse> {
  if (chatResult.content === null) {
    throw new Error(`Provider "${chatResult.provider}" returned no content to persist.`);
  }

  const metadata: MessageMetadata = {
    provider: chatResult.provider,
    model: chatResult.model,
    finish_reason: chatResult.finishReason,
    latency_ms: latencyMs,
    ...(chatResult.usage !== undefined && { token_usage: chatResult.usage }),
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };

  return appendMessage({
    conversation_id: context.conversation_context.conversation.id,
    role: "assistant",
    content: chatResult.content,
    metadata,
  });
}

// "responded" and "completed" carry the same payload — always exactly once
// per turn, even with Tool Calling (Étape 8): the whole tool round-trip
// loop resolves inside runProviderLoop before persistResponse ever runs,
// so there is only ever one persisted reply per turn to publish, not one
// per tool round-trip as Étape 6's own comment once speculated. They stay
// two separate emits anyway — a future subscriber caring about "a reply
// exists" (workflows, notifications) versus one caring about "this turn is
// fully settled" (metrics) still has two names to attach to, even though
// nothing distinguishes their timing today.
async function publishEvents(response: AgentResponse): Promise<void> {
  const payload = { conversation: response.conversation, message: response.message };
  await emitAgentEvent("conversation.responded", payload);
  await emitAgentEvent("conversation.completed", payload);
}

export async function executeConversation(
  request: AgentRequest,
  options: AgentEngineOptions = {}
): Promise<AgentResponse> {
  const context = await loadContext(request, options);
  ensureAgentCanRun(context);

  // Emitted only once the turn is actually going to run — a rejection above
  // (agent inactive) never counts as "started".
  await emitAgentEvent("conversation.started", { conversation: context.conversation_context.conversation });

  const messages = buildPrompt(context);

  const startedAt = Date.now();
  const { result: chatResult, toolCalls } = await runProviderLoop(context, messages);
  const latencyMs = Date.now() - startedAt;

  const response = await persistResponse(context, chatResult, latencyMs, toolCalls);
  await publishEvents(response);
  await maybeSummarizeConversation(context);

  return response;
}
