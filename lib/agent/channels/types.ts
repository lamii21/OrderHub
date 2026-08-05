// The channel abstraction — same philosophy as lib/platforms/types.ts
// (PlatformConnector) and lib/ai/types.ts (ChatProvider/EmbeddingProvider):
// an interface first, a registry once a real implementation exists to put
// in it (Phase 8, starting with WhatsApp), never the other way around.
//
// This is the contract that keeps lib/agent/conversation/service.ts and
// lib/agent/memory/ entirely ignorant of which channel a conversation came
// from. A channel adapter's job is exactly the translation at that
// boundary: turn a channel-specific raw payload into the plain values the
// (already channel-agnostic) conversation service already accepts, and turn
// a plain text reply into whatever that channel's own API expects to send
// it back out. Nothing on this interface is WhatsApp/Telegram/web-specific
// by name — see the Phase 4 architecture review §7 for why that's the one
// property this whole subsystem exists to guarantee.

// Everything a raw inbound payload might actually carry, once a concrete
// adapter (Phase 8+) has parsed it — deliberately minimal: a channel
// message only ever gives you a thread id, some text, and (sometimes)
// who's on the other end. City/address/email are never available at this
// point; lib/customer.ts fills those in separately, later, if at all.
export type NormalizedInboundMessage = {
  external_thread_id: string;
  content: string;
  customer: { phone: string; name: string | null } | null;
};

export interface ChannelAdapter {
  readonly channel: string;

  // Returns null for a payload that isn't actually a new message — e.g.
  // WhatsApp Cloud API delivers delivery/read receipts on the same
  // webhook as real messages; a shared inbound handler (a later phase)
  // needs a clean way to skip those instead of every adapter inventing
  // its own sentinel value for "nothing to do here".
  parseInboundMessage(rawPayload: unknown): NormalizedInboundMessage | null;

  // Expected to throw on failure, never return a {success} result — same
  // convention already established by PlatformConnector's data-fetching
  // methods and AiProvider.chat()/embed(), so a caller handles every
  // interchangeable-provider abstraction in this project the same way.
  sendMessage(externalThreadId: string, content: string): Promise<void>;
}
