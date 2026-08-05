import type { ChatMessage } from "@/lib/ai";
import { toChatMessage } from "../prompt/builder";
import type { AgentMessage } from "../types";

// A pure function boundary, exactly like prompt/builder.ts's buildPrompt —
// no I/O, no wall-clock reads, same conversation history (plus whatever
// summary already existed) always produces the same ChatMessage[] out. This
// is what lets summary quality be tested on its own, without a provider or
// a database anywhere in the test — the same reason Phase 5's own prompt
// builder got split into its own file.

const SUMMARIZATION_INSTRUCTIONS =
  "You summarize a customer service conversation for internal use by an AI sales agent. " +
  "Produce a concise summary (a few sentences, under 500 characters) capturing the customer's " +
  "intent, key facts, and preferences. Do not include pleasantries or restate these instructions.";

// previousSummary is folded into the system message rather than sent as a
// prior assistant turn — it's an instruction to build on ("here is what you
// already knew"), not something the model itself said in this exchange.
export function buildSummaryPrompt(previousSummary: string | undefined, recentMessages: AgentMessage[]): ChatMessage[] {
  const systemSections = [SUMMARIZATION_INSTRUCTIONS];

  if (previousSummary) {
    systemSections.push(`Previous summary: ${previousSummary}`);
  }

  const systemMessage: ChatMessage = { role: "system", content: systemSections.join("\n\n") };
  const historyMessages = recentMessages.map(toChatMessage);

  return [systemMessage, ...historyMessages];
}
