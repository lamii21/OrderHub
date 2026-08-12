import type { ChatResult } from "@/lib/ai";
import { assembleExecutionContext } from "../context/service";
import { buildPrompt } from "../prompt/builder";
import { appendMessage } from "../conversation/service";
import { emitAgentEvent } from "../events";
import { maybeSummarizeConversation } from "../summary/service";
import { retrieveRelevantChunks } from "../rag/retriever";
import { normalizeRagQuery } from "../rag/query-normalization";
import { runProviderLoop } from "./provider-loop";
import type { AgentEngineOptions, AgentExecutionContext, AgentRequest, AgentResponse } from "./types";
import type { AgentToolCall, MessageMetadata } from "../types";
import type { RetrievedChunk } from "../rag/types";

// The engine's own top-level shape, named as a pipeline the way the Phase 5
// review asked for: loadContext -> ensureAgentCanRun -> retrieveContext ->
// buildPrompt -> runProviderLoop -> persistResponse -> publishEvents ->
// maybeSummarizeConversation. Each step below is a private wrapper even
// where (like loadContext) it does nothing beyond delegate today — the
// point is that executeConversation() itself stays readable as this list
// of names, not that every wrapper is doing complex work yet.
//
// The engine never imports a workflow, a notifier, or anything else that
// reacts to what it just did — it only calls emitAgentEvent() (the same bus
// conversation/service.ts already publishes to) and lets whatever is
// subscribed react. Nothing is subscribed yet; that bridge is a later
// phase's job, not this one's. maybeSummarizeConversation
// (lib/agent/summary/) and retrieveContext (lib/agent/rag/, Étape 8.5) are
// the two exceptions to "never call anything but a private wrapper" —
// neither is a workflow or a notifier, just this conversation's own memory
// or knowledge base being read, which is why both live inside lib/agent/
// rather than being reached via an event subscriber.

async function loadContext(request: AgentRequest, options: AgentEngineOptions): Promise<AgentExecutionContext> {
  return assembleExecutionContext(request.conversation_id, options);
}

function ensureAgentCanRun(context: AgentExecutionContext): void {
  if (!context.agent_config.is_active) {
    throw new Error(`AI agent is not active for shop ${context.conversation_context.shop.id}.`);
  }
}

// Skipped entirely — never even resolving a query — when the shop hasn't
// opted in (rag_enabled: false, the default): retrieval has a real cost
// (an embedding API call, a vector search) on every single turn, not worth
// paying for a shop that never configured any documents. No try/catch
// needed here: retrieveRelevantChunks (Étape 8.4) already guarantees it
// never throws, returning [] for every failure mode itself — this
// function only adds the one decision that's genuinely the engine's to
// make (whether to call it at all), never a second layer of error
// handling around a function that doesn't need one.
function findLatestUserMessage(context: AgentExecutionContext): string | null {
  const { recent_messages } = context.conversation_context;

  for (let i = recent_messages.length - 1; i >= 0; i--) {
    if (recent_messages[i].role === "user") {
      return recent_messages[i].content;
    }
  }

  return null;
}

async function retrieveContext(context: AgentExecutionContext): Promise<RetrievedChunk[]> {
  if (!context.agent_config.rag_enabled) {
    return [];
  }

  const queryText = findLatestUserMessage(context);

  if (queryText === null) {
    return [];
  }

  // Only the text handed to RAG is normalized (Étape 10.9.z.1) — queryText
  // itself is a local variable used nowhere else; the provider/LLM and its
  // tool_calls (runProviderLoop, below) read the conversation's own
  // messages directly, never this function's return value, so they always
  // see the customer's original wording, structured references included.
  return retrieveRelevantChunks(
    context.conversation_context.shop.id,
    normalizeRagQuery(queryText),
    context.agent_config.rag_top_k ?? undefined
  );
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

  // A new object, not a mutation of `context` — assembleExecutionContext
  // already populated retrieved_context: [] as a placeholder (Étape 8.0);
  // this replaces it with the real result, same "each step produces its
  // own value" style the rest of this pipeline already follows.
  const contextWithRetrieval: AgentExecutionContext = {
    ...context,
    retrieved_context: await retrieveContext(context),
  };

  const messages = buildPrompt(contextWithRetrieval);

  const startedAt = Date.now();
  const { result: chatResult, toolCalls } = await runProviderLoop(contextWithRetrieval, messages);
  const latencyMs = Date.now() - startedAt;

  const response = await persistResponse(contextWithRetrieval, chatResult, latencyMs, toolCalls);
  await publishEvents(response);
  await maybeSummarizeConversation(contextWithRetrieval);

  return response;
}
