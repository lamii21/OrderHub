# OrderHub — AI Agent Security

Every claim below is verified against the current code (file + line referenced), not assumed.
Scope: the conversational Agent (Tools + RAG) only — see the main
[README.md](../README.md#security-notes) for the platform's general security notes
(authentication, RLS, webhook validation).

## 1. `customer_id` and `shop_id` never come from the model

`runProviderLoop()` builds one `ToolExecutionContext` per turn, before any tool is dispatched:

```ts
// lib/agent/engine/provider-loop.ts:41-48
const toolExecutionContext = {
  shop_id: context.conversation_context.shop.id,
  conversation_id: context.conversation_context.conversation.id,
  customer_id: context.conversation_context.conversation.customer_id,
};
```

Both values come from the conversation's own database row, resolved from the channel (WhatsApp
phone number, or the console's explicit customer picker) **before** the LLM ever runs. A tool
call's `arguments` are read for things like `order_id` or `status`, never for `customer_id` or
`shop_id` — even if a model somehow included one, no tool implementation reads it.

## 2. Tools are bound to the current customer, enforced in the database query

Every customer-scoped tool filters by `context.customer_id` at the Supabase query level, not
just in application logic:

- `search_orders` / `get_order_status` — `.eq("customer_id", customerId)`
- `get_customer` — verifies the customer belongs to `shop_id` before calling the
  `get_customer_stats` RPC (which has no `shop_id` parameter of its own — the ownership check
  exists specifically to compensate for that)
- `get_invoice` — resolves the order (scoped by shop + customer) before looking up its invoice

If `context.customer_id` is `null` (no customer resolved for this conversation), every one of
these tools returns a `no_customer_identified`/empty result rather than querying without a
filter.

## 3. No internal Supabase id is ever returned to the model or the customer

Verified column-by-column:

- Orders: `ORDER_COLUMNS` (`lib/agent/tools/orders/repository.ts`) selects `order_id` (the
  merchant-facing text id) — never the internal bigint `id`.
- Invoices: the internal `id` is read only to derive `invoice_number` (`INV-000123`); the raw id
  itself is never part of `InvoiceForCustomer`, the type actually returned.
- Customer stats: the `get_customer_stats` RPC returns `order_count`, `ltv`, `last_order_at`
  only — no id, no PII beyond what the customer already knows about themselves.

## 4. RAG is scoped to the shop at the SQL level, not just in application code

```sql
-- supabase/schema.sql, match_agent_document_chunks()
where c.shop_id = p_shop_id
  and c.embedding is not null
```

Cross-shop retrieval is not an application-logic guarantee that could be bypassed by a bug
elsewhere — it's a `where` clause in the one function that ever reads `agent_document_chunks`.

## 5. Tool failures never become silent hallucinations

`dispatchToolCall()` (`lib/agent/tools/dispatch.ts`) never throws — an unknown tool name or a
failed execution both become `{ status: "failed", error }`, fed back to the model as an explicit
`role: "tool"` message. The model reacts to a real, visible error rather than being handed
nothing and left to guess.

## 6. Grounding instruction (added after live validation)

`buildSystemPrompt()` explicitly instructs the model to only state facts backed by a tool result
or the RAG section, and to say plainly when it doesn't know. This is a **mitigation**, not a
formal guarantee — see [LIMITATIONS.md](LIMITATIONS.md) for what it does and doesn't cover.

## 7. Credentials

The conversational agent's OpenRouter API key is stored per-shop in `module_credentials`
(`module_name: "ai-sales-agent"`), configured through `/shops/[id]/integrations`, read only
server-side (`lib/agent/context/repository.ts`'s `getAgentCredentials`) and never sent to the
browser. The embedding provider's credentials (Gemini) are platform-wide, read from environment
variables only — never a per-shop, user-editable value (the shared `vector(768)` column requires
every shop's embeddings to come from the same model).

## What this document does not cover

- Rate limiting / abuse protection on the Agent Test Console beyond normal authenticated-session
  access (no dedicated throttling exists for `/shops/[id]/agent/console` — it's gated by Supabase
  Auth + RLS ownership checks, same as every other shop-scoped page).
- Prompt-injection resistance beyond the grounding instruction — not formally tested against
  adversarial inputs.
