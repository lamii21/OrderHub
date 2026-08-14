import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeDecodeURIComponent } from "@/lib/utils";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { ICONS } from "@/components/icons";
import { startConsoleConversation, sendConsoleMessage } from "./actions";

export const revalidate = 0;

type SearchParams = { conversation_id?: string; error?: string };

type ToolCallMetadata = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "pending" | "succeeded" | "failed";
  result?: unknown;
  error?: string;
};

function ToolCallBadge({ call }: { call: ToolCallMetadata }) {
  const tone = call.status === "succeeded" ? "success" : call.status === "failed" ? "danger" : "neutral";

  return (
    <details className="group rounded-md border border-neutral-200 bg-neutral-50 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5">
        <Icon path={ICONS.bolt} className="h-3.5 w-3.5 text-neutral-400" />
        <code className="font-medium text-neutral-700">{call.name}</code>
        <Badge tone={tone}>{call.status}</Badge>
        <Icon
          path={ICONS.chevronDown}
          className="ml-auto h-3.5 w-3.5 text-neutral-400 transition-transform group-open:rotate-180"
        />
      </summary>
      <pre className="overflow-x-auto whitespace-pre-wrap border-t border-neutral-200 px-2 py-1.5 text-[11px] text-neutral-500">
        args: {JSON.stringify(call.arguments)}
        {call.status === "succeeded" && `\nresult: ${JSON.stringify(call.result)}`}
        {call.status === "failed" && `\nerror: ${call.error}`}
      </pre>
    </details>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default async function ShopAgentConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = await createSupabaseServerClient();

  const [{ data: shop, error: shopError }, { data: customers, error: customersError }] = await Promise.all([
    supabase.from("shops").select("id, name").eq("id", id).single(),
    supabase.from("customers").select("id, name, phone").eq("shop_id", id).order("name"),
  ]);

  if (shopError || !shop) {
    notFound();
  }

  if (customersError) {
    console.error("Agent console: failed to load customers:", customersError);
  }

  const conversationId = sp.conversation_id;

  // RLS's own "Users can view conversations for their own shops" /
  // "...messages for their own shops' conversations" policies are what
  // actually stop this from reading another user's conversation for a
  // guessed id — no separate ownership check needed for a plain read like
  // this one (unlike the write actions, which bypass RLS via the engine's
  // service-role client and so check ownership explicitly themselves).
  const [{ data: conversation }, { data: messages, error: messagesError }] = conversationId
    ? await Promise.all([
        supabase
          .from("agent_conversations")
          .select("id, customer_id, external_thread_id, status")
          .eq("id", conversationId)
          .eq("shop_id", id)
          .maybeSingle(),
        supabase
          .from("agent_messages")
          .select("id, role, content, metadata, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
      ])
    : [{ data: null }, { data: null, error: null }];

  if (messagesError) {
    console.error("Agent console: failed to load messages:", messagesError);
  }

  const speakingAsCustomer = conversation?.customer_id
    ? (customers ?? []).find((c) => c.id === conversation.customer_id)
    : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Agent Test Console</h1>
          <p className="mt-1 text-sm text-neutral-500">{shop.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={`/shops/${shop.id}/agent`} className="text-neutral-500 hover:text-neutral-700">
            ← Agent Settings
          </Link>
          <Link
            href={`/shops/${shop.id}/agent/console`}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
          >
            + New conversation
          </Link>
        </div>
      </div>

      <p className="text-sm text-neutral-500">
        Talks to this shop&apos;s real agent through the same <code className="rounded bg-neutral-100 px-1">executeConversation()</code>{" "}
        engine every channel uses — nothing simulated. Requires the agent to be active with an
        OpenRouter key configured.
      </p>

      {sp.error && (
        <p className="rounded-md border border-danger-100 bg-danger-50 p-3 text-sm text-danger-700">
          Engine error: {safeDecodeURIComponent(sp.error)}
        </p>
      )}

      {!conversation ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900">Start a conversation</h2>
          <form action={startConsoleConversation} className="space-y-4">
            <input type="hidden" name="shop_id" value={shop.id} />
            <div>
              <label htmlFor="customer_id" className="mb-1 block text-sm font-medium text-neutral-700">
                Speaking as
              </label>
              <select
                id="customer_id"
                name="customer_id"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <option value="">No customer (anonymous)</option>
                {(customers ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name ?? customer.phone} (#{customer.id})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-400">
                Pick a customer to test tools that read order history, or leave anonymous to test
                the no-customer-identified path.
              </p>
            </div>
            <SubmitButton pendingLabel="Starting…">Start Conversation</SubmitButton>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs text-neutral-500 shadow-sm">
            <Badge tone={conversation.status === "open" ? "success" : "neutral"}>{conversation.status}</Badge>
            <span>Conversation #{conversation.id}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Icon path={ICONS.user} className="h-3.5 w-3.5" />
              {speakingAsCustomer ? speakingAsCustomer.name ?? speakingAsCustomer.phone : "Anonymous"}
            </span>
          </div>

          <div className="flex min-h-[24rem] flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm sm:p-6">
            {(messages ?? []).length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
                <Icon path={ICONS.robot} className="h-8 w-8 text-neutral-300" />
                <p className="text-sm text-neutral-400">No messages yet — send one below to start.</p>
              </div>
            )}
            {(messages ?? []).map((message) => {
              const toolCalls = (message.metadata as { tool_calls?: ToolCallMetadata[] } | null)?.tool_calls ?? [];
              const isUser = message.role === "user";
              return (
                <div key={message.id} className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
                  <div className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                        isUser ? "bg-brand-600 text-white" : "bg-neutral-800 text-white"
                      }`}
                    >
                      {isUser ? "You" : "AI"}
                    </div>
                    <div
                      className={`max-w-[75vw] rounded-2xl px-4 py-2 text-sm sm:max-w-md ${
                        isUser
                          ? "rounded-br-sm bg-brand-600 text-white"
                          : message.role === "assistant"
                            ? "rounded-bl-sm bg-neutral-100 text-neutral-900"
                            : "rounded-bl-sm bg-warning-50 text-warning-700"
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    </div>
                  </div>
                  <span className={`px-9 text-[11px] text-neutral-400 ${isUser ? "text-right" : ""}`}>
                    {formatTime(message.created_at)}
                  </span>
                  {toolCalls.length > 0 && (
                    <div className="ml-9 flex w-full max-w-md flex-col gap-1">
                      {toolCalls.map((call) => (
                        <ToolCallBadge key={call.id} call={call} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <form action={sendConsoleMessage} className="flex gap-2">
            <input type="hidden" name="shop_id" value={shop.id} />
            <input type="hidden" name="conversation_id" value={conversation.id} />
            <input
              name="message"
              type="text"
              required
              placeholder="Type a message as the customer…"
              autoComplete="off"
              className="flex-1 rounded-full border border-neutral-300 px-4 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
            />
            <SubmitButton
              pendingLabel="Sending…"
              className="flex w-auto items-center gap-2 rounded-full px-5 py-2.5"
            >
              <Icon path={ICONS.send} className="h-4 w-4" />
              <span className="hidden sm:inline">Send</span>
            </SubmitButton>
          </form>
        </div>
      )}
    </main>
  );
}
