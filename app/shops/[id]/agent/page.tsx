import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/submit-button";
import { AVAILABLE_TOOL_NAMES } from "@/lib/agent/tools/registry";
import { AGENT_TONES, AGENT_LANGUAGES } from "@/lib/agent-settings";
import { saveAgentSettings } from "./actions";
import type { AiAgentConfig } from "@/lib/agent/types";

export const revalidate = 0;

type SearchParams = { saved?: string; error?: string };

export default async function ShopAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = await createSupabaseServerClient();

  // RLS's "Users can view their own shops" / "...their own shop's AI
  // agent" policies are what actually stop this from returning another
  // user's shop or agent config for a guessed id.
  const [{ data: shop, error: shopError }, { data: agentRow, error: agentError }] = await Promise.all([
    supabase.from("shops").select("id, name").eq("id", id).single(),
    supabase
      .from("ai_agents")
      .select("shop_id, is_active, system_prompt, tone, languages, ai_provider, ai_model, enabled_tools, rag_enabled, rag_top_k")
      .eq("shop_id", id)
      .maybeSingle(),
  ]);

  if (shopError || !shop) {
    notFound();
  }

  if (agentError) {
    console.error("Shop agent settings: failed to load ai_agents row:", agentError);
  }

  const agent = agentRow as AiAgentConfig | null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{shop.name} — AI Agent</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/shops/${shop.id}/settings`} className="text-sm text-blue-600 hover:underline">
            ← Back to Settings
          </Link>
          <Link href={`/shops/${shop.id}/integrations`} className="text-sm text-blue-600 hover:underline">
            OpenRouter API key (Integrations) →
          </Link>
          <Link href={`/shops/${shop.id}/knowledge-base`} className="text-sm text-blue-600 hover:underline">
            Knowledge base (RAG documents) →
          </Link>
          <Link href={`/shops/${shop.id}/agent/console`} className="text-sm text-blue-600 hover:underline">
            Test console →
          </Link>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Configures the conversational Agent (Tool calling + RAG) for this shop. The OpenRouter API
        key and model are set separately, under Integrations → &quot;AI Sales Agent (conversational)&quot;
        — this page only controls the agent&apos;s own behavior.
      </p>

      {sp.saved && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Agent settings saved.
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      <div className="rounded-lg border bg-white p-6">
        <form action={saveAgentSettings} className="space-y-4">
          <input type="hidden" name="shop_id" value={shop.id} />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={agent?.is_active ?? false} />
            Agent is active
          </label>
          <p className="text-xs text-gray-400">
            When off, the agent never runs for this shop&apos;s conversations, regardless of channel.
          </p>

          <div>
            <label htmlFor="tone" className="mb-1 block text-sm font-medium text-gray-700">
              Tone
            </label>
            <select
              id="tone"
              name="tone"
              defaultValue={agent?.tone ?? "friendly"}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {AGENT_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {tone[0].toUpperCase() + tone.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Languages</span>
            <div className="space-y-1">
              {AGENT_LANGUAGES.map((lang) => (
                <label key={lang.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`language_${lang.value}`}
                    defaultChecked={(agent?.languages ?? ["fr", "en", "ar-ma"]).includes(lang.value)}
                  />
                  {lang.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Enabled tools</span>
            <p className="mb-2 text-xs text-gray-400">
              Structured-data tools (Supabase). Empty by default — nothing is enabled until checked
              here.
            </p>
            <div className="space-y-1">
              {AVAILABLE_TOOL_NAMES.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`tool_${name}`}
                    defaultChecked={(agent?.enabled_tools ?? []).includes(name)}
                  />
                  <code className="text-xs">{name}</code>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="rag_enabled" defaultChecked={agent?.rag_enabled ?? false} />
            Enable RAG (knowledge base retrieval)
          </label>

          <div>
            <label htmlFor="rag_top_k" className="mb-1 block text-sm font-medium text-gray-700">
              RAG top K <span className="font-normal text-gray-400">(blank = platform default)</span>
            </label>
            <input
              id="rag_top_k"
              name="rag_top_k"
              type="number"
              min={1}
              defaultValue={agent?.rag_top_k ?? ""}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="system_prompt" className="mb-1 block text-sm font-medium text-gray-700">
              System prompt <span className="font-normal text-gray-400">(blank = generic default)</span>
            </label>
            <textarea
              id="system_prompt"
              name="system_prompt"
              rows={4}
              defaultValue={agent?.system_prompt ?? ""}
              placeholder={`You are a sales assistant for ${shop.name}.`}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <SubmitButton pendingLabel="Saving…">Save Agent Settings</SubmitButton>
        </form>
      </div>
    </main>
  );
}
