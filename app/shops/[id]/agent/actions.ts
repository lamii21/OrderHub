"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AVAILABLE_TOOL_NAMES } from "@/lib/agent/tools/registry";
import { SUPPORTED_CHAT_PROVIDERS } from "@/lib/ai";
import { AGENT_LANGUAGES } from "@/lib/agent-settings";
import { logger } from "@/lib/logger";

// RLS-scoped client only, same pattern as every other action in this shop
// tree (integrations/actions.ts, settings/actions.ts): "Users can
// insert/update their own shop's AI agent" (supabase/schema.sql) already
// rejects a shop_id that isn't the caller's own — no separate ownership
// check needed here.
export async function saveAgentSettings(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const supabase = await createSupabaseServerClient();

  const tone = String(formData.get("tone") ?? "friendly");
  const languages = AGENT_LANGUAGES.filter((lang) => formData.get(`language_${lang.value}`) === "on").map(
    (lang) => lang.value
  );
  const enabledTools = AVAILABLE_TOOL_NAMES.filter((name) => formData.get(`tool_${name}`) === "on");
  const ragTopKRaw = String(formData.get("rag_top_k") ?? "").trim();
  const systemPromptRaw = String(formData.get("system_prompt") ?? "").trim();

  const { error } = await supabase.from("ai_agents").upsert(
    {
      shop_id: Number(shopId),
      is_active: formData.get("is_active") === "on",
      // Exactly one provider is registered today (lib/ai/index.ts's own
      // SUPPORTED_CHAT_PROVIDERS) — pinned rather than exposed as a live
      // choice with only one real option.
      ai_provider: SUPPORTED_CHAT_PROVIDERS[0],
      tone,
      languages,
      enabled_tools: enabledTools,
      rag_enabled: formData.get("rag_enabled") === "on",
      rag_top_k: ragTopKRaw === "" ? null : Number(ragTopKRaw),
      system_prompt: systemPromptRaw === "" ? null : systemPromptRaw,
    },
    { onConflict: "shop_id" }
  );

  if (error) {
    console.error("saveAgentSettings failed:", error);
    redirect(`/shops/${shopId}/agent?error=${encodeURIComponent("Could not save agent settings.")}`);
  }

  logger.audit("ai_agent.settings_saved", { shopId, isActive: formData.get("is_active") === "on" });
  redirect(`/shops/${shopId}/agent?saved=1`);
}
