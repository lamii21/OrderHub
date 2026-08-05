import { countMessages } from "../conversation/service";
import { updateSummary } from "../memory/conversation-memory";
import { shouldSummarize } from "./trigger";
import { generateSummary } from "./generate";
import type { AgentExecutionContext } from "../engine/types";

// The engine's one entry point into this module (called at the end of
// engine/execute.ts's pipeline) — best-effort by design. A failure here
// (a provider error, or updateConversationMemory exhausting its retries
// under sustained write conflicts) is caught and logged, never thrown: the
// customer already has their reply by the time this runs, and missing one
// summarization pass is recoverable at the next threshold, whereas
// surfacing it as a failed executeConversation() call would not be. Reuses
// countMessages/updateSummary rather than touching agent_conversations or
// agent_messages directly — this module has no more access to SQL than the
// engine itself does.
export async function maybeSummarizeConversation(context: AgentExecutionContext): Promise<void> {
  const conversationId = context.conversation_context.conversation.id;

  try {
    const messageCount = await countMessages(conversationId);

    if (!shouldSummarize(messageCount)) {
      return;
    }

    const summary = await generateSummary(context, context.conversation_context.recent_messages);
    await updateSummary(conversationId, summary);
  } catch (err) {
    console.error(`maybeSummarizeConversation: failed for conversation ${conversationId}:`, err);
  }
}
