import { getChannelAdapter } from "./registry";
import { getModuleCredentials } from "@/lib/automation-modules/credentials";
import { createOrUpdateCustomer } from "@/lib/customer";
import { resolveConversation, appendMessage } from "../conversation/service";
import { executeConversation } from "../engine/execute";

export type DispatchInboundMessageInput = {
  shopId: number;
  channel: string;
  rawPayload: unknown;
};

// The Channel -> Engine bridge — same role for channels that
// lib/workflows/dispatch.ts's handleEvent() plays for events. Everything
// upstream of this file (a webhook route, Étape 7.4) knows nothing about
// conversations, customers, or the engine; everything downstream of it
// (resolveConversation, executeConversation, the channel adapter) knows
// nothing about HTTP, webhook signatures, or Meta's payload shape. This is
// the one place that's allowed to know about all of it at once.
//
// getChannelAdapter(channel) is the one call in this function that's
// allowed to throw outward — a webhook route built for exactly one channel
// (Étape 7.4's per-shop WhatsApp route) always calls this with a hardcoded,
// known channel string, so a throw here means a real coding mistake, not a
// runtime condition to absorb. Every other failure mode below (no message
// to parse, channel not configured, a write failing, the engine failing,
// delivery failing) is an expected runtime outcome, caught and logged, so
// the caller can always safely acknowledge the webhook with 200 regardless
// of what happened inside.
export async function dispatchInboundMessage(input: DispatchInboundMessageInput): Promise<void> {
  const { shopId, channel, rawPayload } = input;
  const adapter = getChannelAdapter(channel);

  const normalized = adapter.parseInboundMessage(rawPayload);

  if (!normalized) {
    // Not a real message — a delivery/read receipt, an unsupported message
    // type, or a payload the adapter didn't recognize. Nothing to do.
    return;
  }

  // Resolved before any write: if this shop never configured this channel,
  // there is no way to ever reply, so there is no point creating a
  // conversation that can only ever wait forever. credentials stays an
  // opaque Record<string, unknown> here — this function never inspects its
  // shape, only the concrete adapter's own sendMessage() does.
  const credentials = await getModuleCredentials(shopId, channel);

  if (!credentials) {
    console.error(`dispatchInboundMessage: channel "${channel}" is not configured for shop ${shopId}.`);
    return;
  }

  let conversationId: number;

  try {
    const customer = normalized.customer
      ? await createOrUpdateCustomer({
          shopId,
          phone: normalized.customer.phone,
          name: normalized.customer.name,
        })
      : null;

    const conversation = await resolveConversation({
      shop_id: shopId,
      channel,
      external_thread_id: normalized.external_thread_id,
      ...(customer && { customer_id: customer.id }),
    });

    await appendMessage({ conversation_id: conversation.id, role: "user", content: normalized.content });
    conversationId = conversation.id;
  } catch (err) {
    console.error(`dispatchInboundMessage: failed to record an inbound message for shop ${shopId}:`, err);
    return;
  }

  let response: Awaited<ReturnType<typeof executeConversation>>;

  try {
    response = await executeConversation({ conversation_id: conversationId });
  } catch (err) {
    // The customer's message is already persisted above — losing the
    // automated reply here is recoverable (a human can still see the
    // conversation later), losing the message itself would not have been.
    console.error(`dispatchInboundMessage: the engine failed for conversation ${conversationId}:`, err);
    return;
  }

  try {
    await adapter.sendMessage(normalized.external_thread_id, response.message.content, credentials);
  } catch (err) {
    // The reply is already persisted (executeConversation's own
    // persistResponse) even though delivery failed — no retry queue exists
    // for this yet (same "no new infrastructure" posture as
    // lib/rate-limit.ts), a known limitation, not an oversight.
    console.error(`dispatchInboundMessage: failed to deliver the reply for conversation ${conversationId}:`, err);
  }
}
