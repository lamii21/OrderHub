import type { AiCredentials } from "@/lib/ai";
import type { AgentConversation, AgentMessage, AiAgentConfig, ConversationContext } from "../types";

// Contracts only — no logic. What the engine (a later step) will actually
// do with these shapes is deliberately not decided here; this file exists
// so that decision has a fixed target to build toward.

// The one thing needed to process a turn: which conversation to respond
// to. Everything else (shop, customer, memory, recent messages, agent
// config) is assembled from this by context-building (a later step), never
// passed in separately — a caller (a channel's webhook route) is expected
// to have already persisted the customer's message via
// conversation/service.ts's appendMessage() before invoking the engine;
// the engine's job starts from "there is a conversation with something to
// respond to", not from a raw string.
export type AgentRequest = {
  conversation_id: number;
};

// Everything one engine execution needs in hand before it can build a
// prompt or call a provider — the channel-agnostic ConversationContext
// (already defined in ../types) plus the shop's agent configuration, its
// resolved provider credentials, and this run's own options. Assembling
// this is exactly what context-building (a later step) is for; nothing
// here says how. `credentials` was added after this type's first version —
// context assembly originally stopped at agent_config, until building the
// engine revealed nothing anywhere resolved an actual API key.
export type AgentExecutionContext = {
  conversation_context: ConversationContext;
  agent_config: AiAgentConfig;
  credentials: AiCredentials;
  options: AgentEngineOptions;
};

// What executeConversation() returns once it persists the assistant's
// reply — the persisted assistant message already carries everything a
// caller needs about the exchange itself (content,
// provider/model/usage/finishReason, all inside AgentMessage.metadata), so
// this stays a thin pairing of "the message" with "the conversation it
// belongs to", not a second copy of either.
export type AgentResponse = {
  conversation: AgentConversation;
  message: AgentMessage;
};

// Per-execution behavioral knobs — kept to exactly what the immediately
// next steps (context assembly, the minimal engine) actually read.
// Deliberately does not yet include a tool-calling toggle or a
// summary-threshold override: those belong to the steps that implement
// them, added then rather than guessed at now.
export type AgentEngineOptions = {
  max_recent_messages?: number;
  temperature?: number;
};
