# OrderHub — AI Agent Architecture

This document covers the conversational AI Agent (Tool calling + RAG) — the part of OrderHub
built after the core order-management/workflow platform described in the main
[README.md](../README.md). Everything below reflects the code as it actually exists; no planned
or aspirational behavior is described here (see [LIMITATIONS.md](LIMITATIONS.md) for what's
deliberately not built yet).

## What it is

A per-shop conversational assistant that answers customer questions by combining two kinds of
data:

- **Structured data** (orders, products, promo codes, customers, invoices) — read through
  explicit **Tools** the model chooses to call.
- **Unstructured data** (FAQs, policies, notes a merchant writes) — retrieved through **RAG**
  (Retrieval-Augmented Generation) and injected into the model's context.

```
User message
     |
     v
executeConversation()  (lib/agent/engine/execute.ts)
     |
     +-- loadContext            shop, customer, conversation, ai_agents config
     +-- ensureAgentCanRun       rejects if ai_agents.is_active = false
     +-- retrieveContext         RAG (conditional on ai_agents.rag_enabled)
     +-- buildPrompt              system prompt + conversation history
     +-- runProviderLoop          LLM <-> Tools round-trip (OpenRouter)
     +-- persistResponse          writes the assistant's reply
     +-- publishEvents            conversation.responded / .completed
     +-- maybeSummarizeConversation
     |
     v
Response (persisted + returned to the caller)
```

`executeConversation()` is channel-agnostic. Two callers exist today:

- `lib/agent/channels/dispatch.ts` — the WhatsApp webhook path
  (`app/api/whatsapp/webhook/[shopId]/route.ts`). Errors are logged and swallowed so the webhook
  can always return 200; if the engine fails, the customer simply gets no reply for that turn (a
  known, accepted limitation — see LIMITATIONS.md).
- `app/shops/[id]/agent/console/actions.ts` — the **Agent Test Console**
  (`/shops/[id]/agent/console`). Same engine call, but engine failures are surfaced to the
  operator instead of swallowed, since this page exists for testing/demoing, not production
  delivery.

## The important nuance: Tools vs. RAG today

Tools and RAG are **not yet** decided by the same mechanism:

- **Tools**: a genuine LLM decision. The model sees the enabled tools' JSON-schema descriptions
  and decides per-turn whether to call one, none, or several.
- **RAG**: automatically injected into the system prompt whenever `ai_agents.rag_enabled` is
  true — the model never explicitly "chooses" to consult the knowledge base, it's just already
  there in its context every turn RAG is enabled.

So the real architecture is closer to:

```
User
 |
 +-- RAG (automatic, if enabled) --> context section in the system prompt
 |
 +-- LLM --> may call Tools --> Supabase
 |
 v
LLM combines whatever it has --> Response
```

...rather than an explicit "LLM picks Tool vs RAG vs both vs abstain" router. Both paths can
still combine in one answer (the model sees the RAG context *and* can call a tool in the same
turn — validated live, see the "Tool + RAG" scenario in [DEMO.md](DEMO.md)), but the RAG side of
that combination is never a decision the model made — only the Tool side is. Converting RAG into
a callable tool (making it a real decision) is a deliberate, deferred next step — see
LIMITATIONS.md.

## Tool calling

`runProviderLoop()` (`lib/agent/engine/provider-loop.ts`) owns the LLM <-> Tool round-trip, capped
at `MAX_TOOL_ROUNDTRIPS = 5`. Each round: call the provider, and if it asks for tool calls,
dispatch them (in parallel), replay the results back as `role: "tool"` messages, and loop.

The `ToolExecutionContext` (`shop_id`, `conversation_id`, `customer_id`) is built once per turn
from the conversation's own database row — **never** from anything the model outputs. This is
what makes cross-customer/cross-shop data access structurally impossible regardless of what a
tool call's arguments contain (see [SECURITY.md](SECURITY.md)).

### The 6 registered tools (`lib/agent/tools/registry.ts`)

| Tool | Scoped by | Returns |
|---|---|---|
| `get_order_status` | shop + customer | One order's status/product/price by `order_id` |
| `search_products` | shop only | Up to a handful of matching products + variants + stock bucket |
| `check_promo_code` | shop only | Whether a code is valid, expired, or unknown |
| `get_customer` | shop + customer (context, no args) | Order count, LTV, last order date |
| `search_orders` | shop + customer | Up to 5 of the customer's own orders, optional status/product filter |
| `get_invoice` | shop + customer | An invoice by order, or the most recent one |

All 6 are **read-only**. No write tool (e.g. `update_order_status`) exists yet — see
LIMITATIONS.md. Every tool follows the same 3-layer split: `repository.ts` (pure Supabase I/O) ->
`service.ts` (shaping/business rules) -> `tool.ts` (the `ToolDefinition` the registry exposes).

A shop's `ai_agents.enabled_tools` (`text[]`, empty by default) is the opt-in whitelist —
configured through `/shops/[id]/agent`.

## RAG pipeline

| Stage | File | Detail |
|---|---|---|
| Chunking | `lib/agent/rag/chunking.ts` | Paragraph -> sentence -> fixed-window fallback, max 1000 chars/chunk, no overlap |
| Embeddings | `lib/agent/rag/indexing.ts` + `provider-config.ts` | Gemini `text-embedding-004`, `vector(768)`, platform-wide (not per-shop) |
| Storage/search | `lib/agent/rag/repository.ts` | pgvector, `match_agent_document_chunks()` RPC, cosine similarity, scoped by `shop_id` at the SQL level |
| Query normalization | `lib/agent/rag/query-normalization.ts` | Strips only keyword-anchored structured references (`order #1234`, `customer 56`) before the RAG call — see below |
| Retrieval/filtering | `lib/agent/rag/retriever.ts` | `retrieveRelevantChunks()` — threshold **0.72**, max 2 chunks/document, 4000-char context budget, top-k 5 by default |

### Why 0.72, and why query normalization exists

`MIN_RELEVANCE_SCORE = 0.72` was chosen (Phase 10) as the highest threshold that still clears
every observed false positive on a 45-query evaluation set, at the cost of recall: **93.3% hit
rate**, not 100% — a handful of legitimate queries score just under 0.72 and get no context
(documented as a known, accepted trade-off, not a bug — see LIMITATIONS.md).

Query normalization (`normalizeRagQuery()`) exists because a composed question like *"What is the
refund policy for my order #4521?"* was measured to score 0 chunks (the order number dilutes the
embedding) while the same question without the order number scores well. The fix strips only
`order`/`customer`/`invoice` + a following number (with or without `#`) — never a bare number
like "2024" or "$500" that could be semantically meaningful — and applies **only** to the text
sent to RAG. The Tool-calling side of the same turn still sees the original, unmodified message
(so it can still extract the order number itself).

## System prompt

`buildSystemPrompt()` (`lib/agent/prompt/builder.ts`) is a pure function: persona/system_prompt,
tone, supported languages, a grounding instruction (added after live validation showed the model
would otherwise invent a plausible-sounding answer when neither a tool nor RAG had one — see
LIMITATIONS.md for exactly what this does and doesn't guarantee), customer name, conversation
memory (summary/facts/preferences), and the retrieved RAG chunks (if any), each attributed by
title and type only — no score or internal id ever reaches the prompt.

## Rejected / deferred experiments (all documented, none reversed)

| Étape | What was tried | Outcome |
|---|---|---|
| 10.6 | Chunk overlap | Rejected — no measured benefit |
| 10.7 | Jaccard deduplication | Rejected — no measured effect |
| 10.8 | LLM reranking | Experimental, not integrated — helped some zero-hit cases, degraded others |
| — | Explicit Tool/RAG/abstain router | Deferred — current architecture (auto-RAG + LLM-decided Tools) already covers the validated demo scenarios |
| — | `update_order_status` | Deferred — the only write tool; needs its own authorization policy first |

## Folder map

```
lib/agent/
  engine/          executeConversation, runProviderLoop, types
  tools/           registry, dispatch, and one folder per tool (repository/service/tool.ts)
  rag/             chunking, indexing, retriever, query-normalization, repository, types
  prompt/          buildSystemPrompt / buildPrompt
  conversation/    resolveConversation, appendMessage, message history
  context/         assembles shop/customer/agent-config context for one turn
  channels/        WhatsApp adapter + dispatch (the Channel -> Engine bridge)
  memory/          conversation memory (summary/facts/preferences) updates
  summary/         conversation summarization trigger + generation
  events.ts        the conversation.* event bus

app/shops/[id]/
  agent/           AI Agent settings (is_active, tools, RAG, tone, languages, prompt)
  agent/console/   real conversational test console (executeConversation, unmodified)
  knowledge-base/  RAG document CRUD + reindex

supabase/schema.sql   ai_agents, agent_conversations, agent_messages, agent_documents,
                       agent_document_chunks, module_credentials — single source of truth
```
