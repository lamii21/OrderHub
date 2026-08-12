import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/submit-button";
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
  const color =
    call.status === "succeeded"
      ? "bg-green-100 text-green-700"
      : call.status === "failed"
        ? "bg-red-100 text-red-700"
        : "bg-gray-100 text-gray-600";

  return (
    <div className="rounded-md border bg-gray-50 p-2 text-xs">
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${color}`}>
        {call.name} — {call.status}
      </span>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] text-gray-500">
        args: {JSON.stringify(call.arguments)}
        {call.status === "succeeded" && `\nresult: ${JSON.stringify(call.result)}`}
        {call.status === "failed" && `\nerror: ${call.error}`}
      </pre>
    </div>
  );
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

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{shop.name} — Agent Test Console</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/shops/${shop.id}/agent`} className="text-sm text-blue-600 hover:underline">
            ← Back to Agent Settings
          </Link>
          <Link href={`/shops/${shop.id}/agent/console`} className="text-sm text-blue-600 hover:underline">
            New conversation
          </Link>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Talks to this shop&apos;s real agent through the same <code>executeConversation()</code>{" "}
        engine every channel uses — nothing simulated. Requires the agent to be active with an
        OpenRouter key configured.
      </p>

      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Engine error: {decodeURIComponent(sp.error)}
        </p>
      )}

      {!conversation ? (
        <div className="rounded-lg border bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold">Start a conversation</h2>
          <form action={startConsoleConversation} className="space-y-4">
            <input type="hidden" name="shop_id" value={shop.id} />
            <div>
              <label htmlFor="customer_id" className="mb-1 block text-sm font-medium text-gray-700">
                Speaking as
              </label>
              <select id="customer_id" name="customer_id" className="w-full rounded-md border px-3 py-2 text-sm">
                <option value="">No customer (anonymous)</option>
                {(customers ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name ?? customer.phone} (#{customer.id})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                Pick a customer to test tools that read order history, or leave anonymous to test
                the no-customer-identified path.
              </p>
            </div>
            <SubmitButton pendingLabel="Starting…">Start Conversation</SubmitButton>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
            Conversation #{conversation.id} · {conversation.customer_id ? `customer #${conversation.customer_id}` : "anonymous"} ·
            status: {conversation.status}
          </div>

          <div className="space-y-3 rounded-lg border bg-white p-6">
            {(messages ?? []).length === 0 && (
              <p className="text-sm text-gray-400">No messages yet — send one below.</p>
            )}
            {(messages ?? []).map((message) => {
              const toolCalls = (message.metadata as { tool_calls?: ToolCallMetadata[] } | null)?.tool_calls ?? [];
              return (
                <div key={message.id} className={message.role === "user" ? "text-right" : "text-left"}>
                  <div
                    className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      message.role === "user"
                        ? "bg-blue-600 text-white"
                        : message.role === "assistant"
                          ? "bg-gray-100 text-gray-900"
                          : "bg-yellow-50 text-yellow-800"
                    }`}
                  >
                    <div className="mb-1 text-[10px] uppercase tracking-wide opacity-70">{message.role}</div>
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  </div>
                  {toolCalls.length > 0 && (
                    <div className="mt-1 space-y-1">
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
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <SubmitButton pendingLabel="Sending…">Send</SubmitButton>
          </form>
        </div>
      )}
    </main>
  );
}
