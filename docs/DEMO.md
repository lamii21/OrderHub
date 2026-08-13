# OrderHub — Demo Script

A repeatable, low-risk walkthrough (~5-8 minutes) using the persistent demo shop **"OrderHub
Demo"** (`shop_id = 72`, owned by the demo account). Every question below was run live against
the real engine (real OpenRouter + Gemini calls, no simulation) before being included here — see
[LIMITATIONS.md](LIMITATIONS.md) for the 2 known edge cases deliberately left out of this script.

Demo data present on shop 72: 2 customers (Amine Idrissi, Youssef Amrani), 5 products, 5 orders
(one per status), 2 promo codes (one valid, one expired), 1 invoice, 5 indexed knowledge-base
documents (Returns and Refunds, Shipping Policy, Payment Methods, Customer Support, Order
Cancellation).

| # | Step | Where | Say / Do | Expected result | Time |
|---|---|---|---|---|---|
| 1 | Connexion | `/login` | Log in with the demo account | Redirected to `/dashboard` | 15s |
| 2 | Dashboard | `/dashboard` | Point out the orders table + 4 KPI cards | Real orders visible, no explanation needed | 20s |
| 3 | Gestion commandes | `/shops/72` -> `orders/[id]` | Open order **#4521** (Wireless Headphones) | Status "shipped", customer Amine Idrissi | 20s |
| 4 | Agent IA | `/shops/72/agent` | Show the settings: active, 6 tools checked, RAG on | Explain: this is what a merchant configures once | 25s |
| 5 | Tool Calling | `/shops/72/agent/console`, speaking as **Amine** | Type: **"Where is my order #4521?"** | `get_order_status` called with `order_id:"4521"`; reply states "shipped", Wireless Headphones, $89.99 | 35s |
| 6 | RAG | Same conversation | Type: **"What is your refund policy?"** | No tool call; reply matches the indexed "Returns and Refunds" document (30 days, 5-7 business days, shipping non-refundable) | 35s |
| 7 | Tool + RAG | Same conversation | Type: **"What is the refund policy for my order #4521?"** | `get_order_status` called **and** the refund policy retrieved; reply combines both (order status + exact policy) in one answer | 40s |
| 8 | Historique client | Same conversation | Type: **"What's my order history with you?"** | `get_customer` called; reply states 3 orders, $249.94 total spent | 30s |
| 9 | Facture | Same conversation | Type: **"Can I get my latest invoice?"** | `get_invoice` called; reply shows `INV-000002`, $89.99 | 25s |
| 10 | Isolation sécurité | New conversation, speaking as **Youssef** | Type: **"Where is my order #4521?"** | `get_order_status` returns not-found; reply states the order isn't found — **zero mention of Amine's data** | 35s |
| 11 | Abstention | Same conversation (Youssef or Amine) | Type: **"Do you offer gift wrapping?"** | No tool call, no matching knowledge-base document; reply states it doesn't have that information rather than inventing a policy | 30s |

**Total: ~5.2 minutes** of scripted content — leaves 2-3 minutes of buffer for questions inside an
8-minute slot.

## If asked "why didn't it answer X"

Two real, already-diagnosed edge cases exist — mention them proactively if relevant, they show
rigor rather than being hidden:

- Asking about **"shipping policy"** specifically (not "refund policy") currently scores just
  under the retrieval threshold (0.714 vs. 0.72) and the agent honestly says it doesn't have that
  info rather than guessing. This is a measured trade-off of a conservative threshold (93.3% hit
  rate), not a bug — see LIMITATIONS.md §1.
- The free OpenRouter tier can occasionally produce a malformed response on an unusual query
  (observed once, not reproduced) — if it happens live, simply resend the same message.

## Fallback if OpenRouter is rate-limited during the live demo

The free tier has hit transient rate limits multiple times during development. If step 5+ fails
to respond within ~15 seconds, wait ~30-60s and resend, or fall back to narrating the screenshots/
transcript from the last successful validation run (Priority 3/4 reports) rather than blocking
the demo on a live retry.
