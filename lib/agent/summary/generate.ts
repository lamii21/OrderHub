import { getChatProvider, type ChatOptions } from "@/lib/ai";
import { buildSummaryPrompt } from "./builder";
import type { AgentExecutionContext } from "../engine/types";
import type { AgentMessage } from "../types";

// A named constant, not a magic number — same posture as
// trigger.ts's SUMMARY_TRIGGER_INTERVAL. Lower than the main conversation's
// (which has no fixed default), biasing the summarizer toward a
// deterministic, factual condensation rather than a creative one.
export const SUMMARY_TEMPERATURE = 0.3;

// Calls the same provider and credentials already resolved for this shop's
// main conversation (context.credentials, context.agent_config.ai_provider)
// — summarization gets no separate configuration. Throws when the provider
// has nothing to say (same posture as engine/execute.ts's persistResponse
// guard against a null chatResult.content) rather than silently returning
// an empty string; it's summary/service.ts's job to decide that failure is
// best-effort and should be swallowed, not this function's.
export async function generateSummary(
  context: AgentExecutionContext,
  recentMessages: AgentMessage[]
): Promise<string> {
  const previousSummary = context.conversation_context.conversation.memory.summary;
  const messages = buildSummaryPrompt(previousSummary, recentMessages);

  const provider = getChatProvider(context.agent_config.ai_provider);
  const chatOptions: ChatOptions = { temperature: SUMMARY_TEMPERATURE };

  const result = await provider.chat(context.credentials, messages, chatOptions);

  if (result.content === null) {
    throw new Error(`Provider "${result.provider}" returned no content for a conversation summary.`);
  }

  return result.content;
}
