// A named threshold, not a magic number — same posture as
// conversation/service.ts's MAX_MESSAGE_LENGTH and
// memory/conversation-memory.ts's MAX_MEMORY_UPDATE_ATTEMPTS. A plain
// exported constant, not an environment variable: no other threshold in
// this subsystem is env-driven, and a value this cheap to change in code
// doesn't need a deploy-time knob.
export const SUMMARY_TRIGGER_INTERVAL = 10;

// Pure: given how many messages a conversation now has, decide whether this
// is a summarization checkpoint. Every Nth message re-triggers — not "N
// messages since the last summary" — so the rule stays a function of one
// number alone, with nothing to separately track across calls.
export function shouldSummarize(messageCount: number, interval: number = SUMMARY_TRIGGER_INTERVAL): boolean {
  return messageCount > 0 && messageCount % interval === 0;
}
