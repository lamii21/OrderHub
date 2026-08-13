# OrderHub — AI Agent: Known Limitations

Honest, current list — every item here was either measured directly or is a deliberate,
documented scope decision. Nothing below is a surprise waiting to be discovered.

## 1. RAG threshold trades recall for precision (measured: 93.3% hit rate, not 100%)

`MIN_RELEVANCE_SCORE = 0.72` (`lib/agent/rag/retriever.ts`) was picked as the highest value that
clears every known false positive on a 45-query evaluation set — at the cost of a small number of
legitimate queries scoring just under it and getting no context at all.

**Observed directly** on the demo shop: "What is your shipping policy?" scores 0.714 against its
own "Shipping Policy" document — under the 0.72 cutoff by ~0.006. The agent correctly declines
rather than inventing an answer (the grounding instruction, §4 below, does its job), but it also
doesn't answer a question it technically has the right document for. This is the known
recall/precision trade-off of a fixed threshold, not a retrieval bug — confirmed by checking the
raw similarity score directly against the database, not just the filtered result.

**Not changed**: the threshold, chunking, or embeddings were deliberately left untouched during
final validation, per an explicit decision to freeze the retrieval pipeline for delivery.

## 2. Tools and RAG are not decided by the same mechanism yet

See [ARCHITECTURE.md](ARCHITECTURE.md#the-important-nuance-tools-vs-rag-today). RAG is
auto-injected whenever enabled; only Tool calls are a genuine per-turn LLM decision. Both can
still appear in the same answer (validated live), but "should RAG even run for this message" is
not itself a decision the model makes — an explicit Tool/RAG/abstain router is a deferred next
step, not built.

## 3. Grounding is a mitigation, not a proven guarantee

`buildSystemPrompt()` explicitly tells the model to only state tool- or RAG-backed facts and to
say when it doesn't know. Before this instruction existed, a live test showed the model **would**
invent a plausible policy ("Do you offer gift wrapping?" -> a confident, fabricated "Yes, we
do!"). After adding the instruction, the same question and 5 other real scenarios were re-run
live and passed. This is one instruction validated against a small, specific set of real
scenarios — not a formally proven guarantee against every possible phrasing or adversarial
prompt.

## 4. Reranking (Étape 10.8) is experimental, not integrated

An LLM-based reranker was prototyped and measured: it recovered some zero-hit queries but
degraded a few multi-document ones on the same evaluation set, and its cutoff value was never
calibrated. It exists only as historical experimentation notes — no reranking code runs in
production.

## 5. `update_order_status` is not implemented

The only tool that would *write* data. Deliberately deferred — a write tool needs its own
confirmation/authorization policy (should the agent be allowed to cancel an order on a customer's
word alone? does it need a human-in-the-loop step?) that hasn't been designed yet. Every shipped
tool is read-only.

## 6. No inventory/payment tools

`inventory` and `payments` are not real tables in this schema (verified against
`supabase/schema.sql`) — stock lives on `products.stock_quantity`, and the closest thing to a
payment record is `invoices` (amount/currency/issued_at only, no payment-status concept). No
`get_inventory`/`get_payment` tool was built for data that doesn't exist.

## 7. Free-tier model output can be unstable

One live scenario ("Where is my order #9999?", a non-existent order) produced a garbled response
with leaked reasoning text and no tool call, using the free-tier OpenRouter model
(`nvidia/nemotron-3.5-lightning:free`). The identical code path (`get_order_status` returning
`not_found`) worked correctly in two other live scenarios in the same session, which points to an
isolated model-output glitch rather than a pipeline defect — but it was not reproduced on demand
(a second attempt hit the free tier's own rate limit). Treated as a residual, low-probability risk
of the free model tier, not something the pipeline code can fix.

## 8. WhatsApp channel fails silently on an engine error

`dispatchInboundMessage()` (`lib/agent/channels/dispatch.ts`) logs and swallows an
`executeConversation()` failure so the webhook can always return 200 — the customer's message is
still saved, but they get no automated reply for that turn, and nothing retries it. The Agent
Test Console (used for demos) does not have this limitation — engine errors are shown directly to
the operator there.

## 9. No formal admin control over the console

`/shops/[id]/agent/console` is gated the same way every shop-scoped page is (Supabase Auth +
RLS ownership), with no additional rate limiting of its own. It calls the real engine with real
provider credentials — each message sent through it is a real, billed API call.
