import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeDecodeURIComponent } from "@/lib/utils";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { ICONS } from "@/components/icons";
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
  const [
    { data: shop, error: shopError },
    { data: agentRow, error: agentError },
    { count: documentCount },
    { count: conversationCount },
    { data: latestConversation },
  ] = await Promise.all([
    supabase.from("shops").select("id, name").eq("id", id).single(),
    supabase
      .from("ai_agents")
      .select("shop_id, is_active, system_prompt, tone, languages, ai_provider, ai_model, enabled_tools, rag_enabled, rag_top_k")
      .eq("shop_id", id)
      .maybeSingle(),
    supabase.from("agent_documents").select("id", { count: "exact", head: true }).eq("shop_id", id),
    supabase.from("agent_conversations").select("id", { count: "exact", head: true }).eq("shop_id", id),
    // A tiny "conversation preview" — the most recent conversation's last
    // couple of messages, so this page shows the agent doing something
    // real instead of only exposing a settings form. Best-effort: no
    // conversations yet is a normal, expected state, not an error.
    supabase
      .from("agent_conversations")
      .select("id, last_message_at, agent_messages(role, content, created_at)")
      .eq("shop_id", id)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (shopError || !shop) {
    notFound();
  }

  if (agentError) {
    console.error("Shop agent settings: failed to load ai_agents row:", agentError);
  }

  const agent = agentRow as AiAgentConfig | null;
  const isActive = agent?.is_active ?? false;
  const enabledToolsCount = agent?.enabled_tools?.length ?? 0;

  type PreviewMessage = { role: string; content: string; created_at: string };
  const previewMessages = (
    (latestConversation?.agent_messages as PreviewMessage[] | null) ?? []
  )
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-2);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-neutral-900">AI Agent</h1>
            <Badge tone={isActive ? "success" : "neutral"}>{isActive ? "Active" : "Inactive"}</Badge>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {shop.name} · Tool calling + RAG, powered by OpenRouter
          </p>
        </div>
        <Link
          href={`/shops/${shop.id}/agent/console`}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
        >
          <Icon path={ICONS.send} className="h-4 w-4" />
          Open Test Console
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/shops/${shop.id}/settings`} className="text-neutral-500 hover:text-neutral-700">
          ← Back to Settings
        </Link>
        <Link href={`/shops/${shop.id}/integrations`} className="font-medium text-brand-600 hover:text-brand-700">
          OpenRouter API key →
        </Link>
        <Link href={`/shops/${shop.id}/knowledge-base`} className="font-medium text-brand-600 hover:text-brand-700">
          Knowledge base →
        </Link>
      </div>

      {sp.saved && (
        <p className="rounded-md border border-success-100 bg-success-50 p-3 text-sm text-success-700">
          Agent settings saved.
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-danger-100 bg-danger-50 p-3 text-sm text-danger-700">
          {safeDecodeURIComponent(sp.error)}
        </p>
      )}

      {/* ---- Status overview ---- */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-neutral-500">
            <Icon path={ICONS.robot} className="h-4 w-4" />
            <p className="text-sm">Tools enabled</p>
          </div>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">
            {enabledToolsCount} <span className="text-base font-normal text-neutral-400">/ {AVAILABLE_TOOL_NAMES.length}</span>
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-neutral-500">
            <Icon path={ICONS.book} className="h-4 w-4" />
            <p className="text-sm">RAG</p>
          </div>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">
            {agent?.rag_enabled ? "On" : "Off"}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-neutral-500">
            <Icon path={ICONS.document} className="h-4 w-4" />
            <p className="text-sm">KB documents</p>
          </div>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{documentCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-neutral-500">
            <Icon path={ICONS.send} className="h-4 w-4" />
            <p className="text-sm">Conversations</p>
          </div>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{conversationCount ?? 0}</p>
        </div>
      </div>

      {/* ---- Enabled tools, read-only chips (editable below in the form) ---- */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-sm font-semibold text-neutral-900">Enabled tools</p>
        {enabledToolsCount === 0 ? (
          <p className="text-sm text-neutral-400">No tools enabled yet — check some below.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_TOOL_NAMES.filter((name) => agent?.enabled_tools?.includes(name)).map((name) => (
              <Badge key={name} tone="brand">
                <code>{name}</code>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ---- Conversation preview ---- */}
      {previewMessages.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <p className="text-sm font-semibold text-neutral-900">Latest conversation</p>
            <Link
              href={`/shops/${shop.id}/agent/console?conversation_id=${latestConversation?.id}`}
              className="text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Open in console →
            </Link>
          </div>
          <div className="space-y-2 p-4">
            {previewMessages.map((message, i) => (
              <div key={i} className={message.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={`inline-block max-w-[80%] truncate rounded-lg px-3 py-1.5 text-sm ${
                    message.role === "user" ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-900"
                  }`}
                >
                  {message.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-neutral-500">
        The OpenRouter API key and model are set separately, under Integrations → &quot;AI Sales
        Agent (conversational)&quot; — this page only controls the agent&apos;s own behavior.
      </p>

      {/* ---- Configuration form ---- */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-neutral-900">Configuration</h2>
        <form action={saveAgentSettings} className="space-y-4">
          <input type="hidden" name="shop_id" value={shop.id} />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={agent?.is_active ?? false} />
            Agent is active
          </label>
          <p className="text-xs text-neutral-400">
            When off, the agent never runs for this shop&apos;s conversations, regardless of channel.
          </p>

          <div>
            <label htmlFor="tone" className="mb-1 block text-sm font-medium text-neutral-700">
              Tone
            </label>
            <select
              id="tone"
              name="tone"
              defaultValue={agent?.tone ?? "friendly"}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              {AGENT_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {tone[0].toUpperCase() + tone.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-neutral-700">Languages</span>
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
            <span className="mb-1 block text-sm font-medium text-neutral-700">Enabled tools</span>
            <p className="mb-2 text-xs text-neutral-400">
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
            <label htmlFor="rag_top_k" className="mb-1 block text-sm font-medium text-neutral-700">
              RAG top K <span className="font-normal text-neutral-400">(blank = platform default)</span>
            </label>
            <input
              id="rag_top_k"
              name="rag_top_k"
              type="number"
              min={1}
              defaultValue={agent?.rag_top_k ?? ""}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
            />
          </div>

          <div>
            <label htmlFor="system_prompt" className="mb-1 block text-sm font-medium text-neutral-700">
              System prompt <span className="font-normal text-neutral-400">(blank = generic default)</span>
            </label>
            <textarea
              id="system_prompt"
              name="system_prompt"
              rows={4}
              defaultValue={agent?.system_prompt ?? ""}
              placeholder={`You are a sales assistant for ${shop.name}.`}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
            />
          </div>

          <SubmitButton pendingLabel="Saving…">Save Agent Settings</SubmitButton>
        </form>
      </div>
    </main>
  );
}
