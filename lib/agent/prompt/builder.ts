import type { ChatMessage } from "@/lib/ai";
import type { AgentExecutionContext } from "../engine/types";
import type { AgentMessage, ConversationMemory } from "../types";
import type { RetrievedChunk } from "../rag/types";

// A pure function boundary, deliberately: no I/O, no randomness, no
// wall-clock reads (a "today's date" section would make the same input
// produce different output depending on when it runs — not included for
// exactly that reason). Same AgentExecutionContext in always produces the
// same ChatMessage[] out, which is what makes prompt quality testable on
// its own, without a provider or a database anywhere in the test.

function formatKeyValue(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}

// Phase 8 (RAG). Reads context.retrieved_context, already resolved by the
// engine's own retrieveContext step (Étape 8.5) before buildPrompt ever
// runs — this stays a pure rendering of an already-decided value, no I/O,
// same boundary this whole file has kept since Phase 5 Étape 3. No chunk
// id is rendered (RetrievedChunk never carries one) — title and
// document_type are what let the model attribute an answer ("according to
// our return policy") without one.
function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  const lines = chunks.map((chunk) => `- ${chunk.title} (${chunk.document_type}): ${chunk.content}`);
  return `Relevant information from the shop's knowledge base:\n${lines.join("\n")}`;
}

// Everything the system message can draw on today: the merchant's own
// instructions (or a plain fallback naming the shop, when none is set),
// tone, supported languages, who the customer is (if known), and whatever
// the conversation already remembers. Deliberately says nothing about
// products, promotions, or policies — AgentExecutionContext doesn't carry
// any of that yet (RAG and order/product data belong to later phases);
// referencing them here would be inventing capability the context can't
// actually back up.
export function buildSystemPrompt(context: AgentExecutionContext): string {
  const { agent_config, conversation_context } = context;
  const { shop, customer, conversation } = conversation_context;
  const memory: ConversationMemory = conversation.memory;

  const sections: string[] = [];

  sections.push(
    agent_config.system_prompt?.trim()
      ? agent_config.system_prompt.trim()
      : `You are a sales assistant for ${shop.name}.`
  );

  sections.push(`Tone: ${agent_config.tone}.`);

  if (agent_config.languages.length > 0) {
    sections.push(
      `Respond in the language the customer is using. Supported languages: ${agent_config.languages.join(", ")}.`
    );
  }

  // Explicit grounding instruction — added after Priority 3 validation
  // ("mode finalisation") demonstrated a real hallucination: asked "Do you
  // offer gift wrapping?" (no tool for it, no matching knowledge-base
  // chunk above the 0.72 threshold), the model answered "Yes, we do!" and
  // invented a plausible-sounding policy. A similarly off-topic question
  // ("Can you help me file my taxes?") was correctly declined without this
  // instruction — so abstention was already emergent for clearly
  // out-of-domain questions, but not for in-domain ones the agent simply
  // has no data for. This section is what turns that into an actual
  // instruction rather than a hopeful default; it is not a claim that the
  // model can no longer hallucinate, only that it is now explicitly told
  // not to guess when its two real sources of truth (tool results, the
  // knowledge base section below) are silent.
  sections.push(
    "Only state facts that come from a tool result or from the shop's knowledge base section below (if present). " +
      "If a question isn't answered by either, say plainly that you don't have that information rather than " +
      "guessing or inventing a policy, price, or fact about the shop."
  );

  if (customer?.name) {
    sections.push(`You are speaking with ${customer.name}.`);
  }

  if (memory.summary) {
    sections.push(`Conversation summary so far: ${memory.summary}`);
  }

  if (memory.facts && Object.keys(memory.facts).length > 0) {
    sections.push(`Known facts about this customer: ${formatKeyValue(memory.facts)}`);
  }

  if (memory.preferences && Object.keys(memory.preferences).length > 0) {
    sections.push(`Customer preferences: ${formatKeyValue(memory.preferences)}`);
  }

  if (context.retrieved_context.length > 0) {
    sections.push(formatRetrievedContext(context.retrieved_context));
  }

  return sections.join("\n\n");
}

// The one place an AgentMessage (this domain's own vocabulary) becomes a
// ChatMessage (lib/ai's vocabulary) — the explicit translation between
// bounded contexts that types.ts's own comment on MessageRole already
// promised would happen here, not by aliasing one role type to the other.
//
// Known gap, not silently glossed over: a role: "tool" AgentMessage has no
// way to carry ChatMessage.toolCallId today — AgentMessage has no matching
// field yet, because nothing produces tool-role messages before Tool
// Calling (a later phase) exists. That phase is what adds the field this
// function will then read.
export function toChatMessage(message: AgentMessage): ChatMessage {
  return { role: message.role, content: message.content };
}

export function buildPrompt(context: AgentExecutionContext): ChatMessage[] {
  const systemMessage: ChatMessage = { role: "system", content: buildSystemPrompt(context) };
  const historyMessages = context.conversation_context.recent_messages.map(toChatMessage);

  return [systemMessage, ...historyMessages];
}
