// Shared between app/shops/[id]/agent/page.tsx and its actions.ts, same
// "one source of truth for a settings page's own option lists" role
// lib/shop-settings.ts (CURRENCIES) and lib/sync-schedule.ts
// (SYNC_FREQUENCIES) already play for their own pages.
export const AGENT_TONES = ["friendly", "professional", "casual", "formal"] as const;

export const AGENT_LANGUAGES: { value: string; label: string }[] = [
  { value: "fr", label: "French" },
  { value: "en", label: "English" },
  // 'ar-ma' = Darija (Moroccan Arabic), same value ai_agents.languages and
  // buildSystemPrompt (lib/agent/prompt/builder.ts) already use.
  { value: "ar-ma", label: "Darija (Moroccan Arabic)" },
];
