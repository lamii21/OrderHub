import { sendWhatsAppTextMessage, isWhatsAppCredentials } from "@/lib/whatsapp-client";
import type { ChannelAdapter, NormalizedInboundMessage } from "./types";

// The first concrete ChannelAdapter (Phase 7 Étape 7.2) — types.ts's own
// comment anticipated this exact moment. Reuses lib/whatsapp-client.ts
// (Étape 7.1) for the outbound side entirely: sendMessage() below is a
// thin translation, not a second implementation of the Graph API call.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Meta delivers exactly one webhook shape for everything — new messages AND
// delivery/read receipts share the same POST body, distinguished only by
// which key is present inside `value` (`messages` vs `statuses`). This
// walks entry[].changes[].value once and returns whatever it finds,
// without assuming any of it is there — a malformed or unfamiliar payload
// (a future Graph API version, a message type this adapter doesn't handle)
// must fall through to "nothing to parse here", never throw.
type WhatsAppExtractedEvent = {
  message: Record<string, unknown> | null;
  contactName: string | null;
};

function extractWhatsAppEvent(rawPayload: unknown): WhatsAppExtractedEvent {
  if (!isRecord(rawPayload) || !Array.isArray(rawPayload.entry)) {
    return { message: null, contactName: null };
  }

  for (const entry of rawPayload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;

      const { messages, contacts } = change.value;
      const message = Array.isArray(messages) && isRecord(messages[0]) ? messages[0] : null;

      let contactName: string | null = null;
      if (Array.isArray(contacts) && isRecord(contacts[0]) && isRecord(contacts[0].profile)) {
        const name = contacts[0].profile.name;
        contactName = typeof name === "string" ? name : null;
      }

      if (message) {
        return { message, contactName };
      }
    }
  }

  return { message: null, contactName: null };
}

export const whatsappChannelAdapter: ChannelAdapter = {
  channel: "whatsapp",

  // Returns null for anything that isn't a genuine new text message: a
  // delivery/read receipt (no `messages` key at all — see
  // extractWhatsAppEvent's own comment), or a message type this adapter
  // doesn't handle yet (image, location, interactive button reply, ...) —
  // text is the only type OrderHub's agent can meaningfully respond to
  // today; widening this is additive when it's actually needed, not
  // guessed at now.
  parseInboundMessage(rawPayload: unknown): NormalizedInboundMessage | null {
    const { message, contactName } = extractWhatsAppEvent(rawPayload);

    if (!message) {
      return null;
    }

    if (message.type !== "text" || !isRecord(message.text) || typeof message.text.body !== "string") {
      return null;
    }

    if (typeof message.from !== "string" || message.from === "") {
      return null;
    }

    // WhatsApp has no separate "thread id" concept beyond the customer's
    // own number — the same number is both the addressee for a reply and
    // the natural key that ties every message from this customer into one
    // conversation (conversation/service.ts's own
    // (shop_id, channel, external_thread_id) uniqueness already assumes
    // exactly this).
    return {
      external_thread_id: message.from,
      content: message.text.body,
      customer: { phone: message.from, name: contactName },
    };
  },

  async sendMessage(externalThreadId: string, content: string, credentials: Record<string, unknown>): Promise<void> {
    if (!isWhatsAppCredentials(credentials)) {
      throw new Error("Invalid WhatsApp credentials: expected accessToken and phoneNumberId.");
    }

    await sendWhatsAppTextMessage(credentials, externalThreadId, content);
  },
};
