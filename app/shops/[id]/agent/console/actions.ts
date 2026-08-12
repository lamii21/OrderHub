"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveConversation, appendMessage } from "@/lib/agent/conversation/service";
import { executeConversation } from "@/lib/agent/engine/execute";
import { logger } from "@/lib/logger";

// resolveConversation/appendMessage/executeConversation all write through
// the service-role client (lib/supabase.ts), the same as the WhatsApp
// webhook path (lib/agent/channels/dispatch.ts) — they bypass RLS by
// design (only the engine and channel adapters are meant to write agent_*
// tables, never the browser directly). Since this Server Action calls them
// on a logged-in merchant's behalf rather than going through an RLS
// INSERT/UPDATE itself, ownership has to be checked explicitly here, via a
// plain RLS-scoped SELECT (its own "Users can view their own shops" /
// "...their own conversations" policies reject a shop_id or conversation_id
// that isn't the caller's own) before any write happens.
async function assertOwnsShop(shopId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("shops").select("id").eq("id", shopId).single();

  if (!data) {
    throw new Error("Shop not found or not owned by the current user.");
  }
}

async function assertOwnsConversation(shopId: string, conversationId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("agent_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("shop_id", shopId)
    .single();

  if (!data) {
    throw new Error("Conversation not found or not owned by the current user.");
  }
}

export async function startConsoleConversation(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const customerIdRaw = String(formData.get("customer_id") ?? "").trim();

  await assertOwnsShop(shopId);

  const conversation = await resolveConversation({
    shop_id: Number(shopId),
    channel: "console",
    external_thread_id: `console-${randomUUID()}`,
    ...(customerIdRaw !== "" && { customer_id: Number(customerIdRaw) }),
  });

  logger.audit("agent_console.conversation_started", { shopId, conversationId: conversation.id });
  redirect(`/shops/${shopId}/agent/console?conversation_id=${conversation.id}`);
}

export async function sendConsoleMessage(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const conversationId = String(formData.get("conversation_id") ?? "");
  const message = String(formData.get("message") ?? "").trim();

  await assertOwnsConversation(shopId, conversationId);

  if (message === "") {
    redirect(`/shops/${shopId}/agent/console?conversation_id=${conversationId}`);
  }

  await appendMessage({ conversation_id: Number(conversationId), role: "user", content: message });

  try {
    await executeConversation({ conversation_id: Number(conversationId) });
  } catch (err) {
    // Surfaced to the operator here, on purpose — unlike the WhatsApp path
    // (dispatchInboundMessage), which must log-and-continue so the webhook
    // can still return 200, this console exists specifically to make a
    // failure visible for debugging/demo prep rather than silent.
    console.error(`sendConsoleMessage: executeConversation failed for conversation ${conversationId}:`, err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    redirect(
      `/shops/${shopId}/agent/console?conversation_id=${conversationId}&error=${encodeURIComponent(errorMessage)}`
    );
  }

  redirect(`/shops/${shopId}/agent/console?conversation_id=${conversationId}`);
}
