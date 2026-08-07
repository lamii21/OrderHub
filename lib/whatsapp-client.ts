import { fetchWithTimeout } from "./automation-modules/http";

// The low-level WhatsApp Cloud API (Meta's own Business API) call, shared
// by two callers with genuinely different needs: the outbound automation
// module (lib/automation-modules/whatsapp.ts), which wants a {success}
// result to slot into a workflow step's own outcome; and the future
// WhatsAppChannelAdapter (Phase 7 Étape 7.2), whose ChannelAdapter.sendMessage
// contract expects a thrown error, never a {success} result — same
// convention already established for every other interchangeable-provider
// abstraction in this project (ChatProvider, PlatformConnector). Rather
// than picking one caller's convention and making the other translate
// against the grain, this file throws — the more fundamental of the two,
// since a {success} wrapper is trivial to build on top of a throwing call
// (a try/catch), but not the reverse without losing the original error.
//
// This is a plain top-level lib/ module, not part of lib/automation-modules/
// or lib/agent/ — neither owns the other, and both need this exact same
// HTTP call, so it belongs to neither.

const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

export type WhatsAppCredentials = { accessToken: string; phoneNumberId: string };

export type WhatsAppSendResult = { messageId?: string };

// Extracted here once a second caller (WhatsAppChannelAdapter, Étape 7.2)
// needed the exact same check the automation module already had —
// "extract once duplicated, not before", the same rule already applied to
// tools/shared.ts's escapeLikePattern.
export function isWhatsAppCredentials(value: Record<string, unknown> | null): value is WhatsAppCredentials {
  return !!value && typeof value.accessToken === "string" && typeof value.phoneNumberId === "string";
}

// Distinct from a network/timeout failure (both of which propagate as
// whatever fetchWithTimeout's own fetch() call threw) — this is
// specifically "the API answered, and said no", carrying the HTTP status a
// caller may want to react to differently (e.g. 401 vs 429).
export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

export async function sendWhatsAppTextMessage(
  credentials: WhatsAppCredentials,
  to: string,
  text: string
): Promise<WhatsAppSendResult> {
  const response = await fetchWithTimeout(`${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!response.ok) {
    throw new WhatsAppApiError(`WhatsApp API request failed (HTTP ${response.status}).`, response.status);
  }

  const body = (await response.json()) as { messages?: { id: string }[] };
  const messageId = body.messages?.[0]?.id;

  return messageId ? { messageId } : {};
}
