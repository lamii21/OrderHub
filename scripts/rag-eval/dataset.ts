import type { RagDocumentType } from "@/lib/agent/rag/types";

// Fixture data for the RAG retrieval-quality baseline (Phase 10, Étape
// 10.0). Deliberately plain data with no logic — the runner (10.0.d)
// provisions a throwaway shop from this, indexes it for real, and measures
// retrieval against it. Titles are the join key between a query's expected
// answer and both searchSimilarChunks's document_title and
// RetrievedChunk's title (see this phase's own architecture analysis for
// why: chunk ids are regenerated on every reindex, document titles are
// not). Every title below is unique on purpose — nothing in the schema
// enforces that, so it's this fixture's own responsibility to hold.
export type EvalDocument = {
  type: RagDocumentType;
  title: string;
  content: string;
};

// relevantDocumentTitles is a set, not a single title — a real customer
// question can legitimately be answered by more than one document (see
// "Do you ship internationally?" below, answered by both the shipping and
// the customs/duties documents). An empty array is itself a meaningful
// case: a query this knowledge base has no real answer for, used to check
// what retrieval does when nothing ought to match rather than only ever
// testing the "something should match" path.
export type EvalQuery = {
  query: string;
  relevantDocumentTitles: string[];
};

export type RagEvalDataset = {
  documents: EvalDocument[];
  queries: EvalQuery[];
};

export const RAG_EVAL_DATASET: RagEvalDataset = {
  documents: [
    {
      type: "policy",
      title: "Shipping Times",
      content:
        "Standard shipping within the country takes 2 to 5 business days. Express shipping, available at checkout for an additional fee, arrives within 1 to 2 business days. Orders placed after 3pm are processed the next business day.",
    },
    {
      type: "policy",
      title: "International Shipping and Customs",
      content:
        "We ship to most countries outside our home market. International orders may be subject to customs duties and import taxes, which are the customer's responsibility and are not included in the order total. International delivery typically takes 7 to 14 business days.",
    },
    {
      type: "policy",
      title: "Returns and Refunds",
      content:
        "Items can be returned within 30 days of delivery for a full refund, provided they are unused and in their original packaging. Refunds are issued to the original payment method within 5 to 7 business days of us receiving the returned item.",
    },
    {
      type: "policy",
      title: "Order Cancellation",
      content:
        "Orders can be cancelled free of charge within 1 hour of being placed. After that window, the order has usually already entered fulfillment and cannot be cancelled, but it can still be returned once delivered under our standard returns policy.",
    },
    {
      type: "faq",
      title: "Accepted Payment Methods",
      content:
        "We accept all major credit and debit cards, as well as PayPal. Cash on delivery is available in select regions and will be shown at checkout if it applies to your address.",
    },
    {
      type: "faq",
      title: "How to Track an Order",
      content:
        "Once an order ships, a tracking link is sent by email. The same tracking information is also available by logging into your account and opening the order details page.",
    },
    {
      type: "faq",
      title: "Promo Code Troubleshooting",
      content:
        "Promo codes are case-sensitive and must be entered exactly as provided. A code that isn't working may be expired, may not apply to the items currently in the cart, or may already be in use on the account. Only one promo code can be applied per order.",
    },
    {
      type: "note",
      title: "Customer Support Hours",
      content:
        "Customer support is available Monday through Friday, 9am to 6pm, by email and live chat. Messages sent outside these hours are answered the next business day.",
    },
  ],
  // V1 (Étape 10.0.a) queries — kept exactly as originally written, still
  // the queries that produced the 10.0/10.1/10.2 baselines this project
  // has already reported on.
  queries: [
    { query: "How long does shipping take?", relevantDocumentTitles: ["Shipping Times"] },
    {
      query: "Do you ship internationally, and will I owe customs fees?",
      relevantDocumentTitles: ["International Shipping and Customs", "Shipping Times"],
    },
    { query: "Can I return an item I don't want anymore?", relevantDocumentTitles: ["Returns and Refunds"] },
    { query: "How long do refunds take to process?", relevantDocumentTitles: ["Returns and Refunds"] },
    { query: "I just placed an order, can I still cancel it?", relevantDocumentTitles: ["Order Cancellation"] },
    { query: "What payment methods do you accept?", relevantDocumentTitles: ["Accepted Payment Methods"] },
    { query: "Can I pay with PayPal?", relevantDocumentTitles: ["Accepted Payment Methods"] },
    { query: "How do I track my package?", relevantDocumentTitles: ["How to Track an Order"] },
    { query: "My promo code isn't working, why?", relevantDocumentTitles: ["Promo Code Troubleshooting"] },
    { query: "Can I use two discount codes on the same order?", relevantDocumentTitles: ["Promo Code Troubleshooting"] },
    { query: "What are your customer service hours?", relevantDocumentTitles: ["Customer Support Hours"] },
    { query: "Is it possible to pay cash when the order is delivered?", relevantDocumentTitles: ["Accepted Payment Methods"] },
    {
      query: "Do you offer same-day delivery in another galaxy?",
      relevantDocumentTitles: [],
    },

    // ---- V2 additions (Étape 10.3) — 37 new queries, same 8 documents,
    // no production logic touched. Purpose: revalidate MIN_RELEVANCE_SCORE
    // (0.74, Étape 10.1/10.2) on a less easily-overfit sample, and probe
    // document-boundary confusion deliberately rather than discovering it
    // by accident the way 10.1 did. See this étape's own design report for
    // the full category rationale. Categories below are transversal labels
    // for how this dataset was composed, not a runtime concept — each
    // query still appears exactly once in the array either way.

    // -- Livraison/délais (+4, 5 total with the V1 query above)
    { query: "When will my order arrive if I order today?", relevantDocumentTitles: ["Shipping Times"] },
    { query: "Is express shipping available at checkout?", relevantDocumentTitles: ["Shipping Times"] },
    { query: "What happens if I place my order late at night?", relevantDocumentTitles: ["Shipping Times"] },
    {
      query: "Does delivery take longer for orders outside the country?",
      relevantDocumentTitles: ["International Shipping and Customs"],
    },

    // -- Retours/remboursements (+3, 5 total)
    { query: "What's your return policy?", relevantDocumentTitles: ["Returns and Refunds"] },
    { query: "Do I need the original packaging to return something?", relevantDocumentTitles: ["Returns and Refunds"] },
    { query: "How will I get my money back after a return?", relevantDocumentTitles: ["Returns and Refunds"] },

    // -- Annulation (+3, 4 total)
    { query: "How do I stop my order?", relevantDocumentTitles: ["Order Cancellation"] },
    { query: "Is there a deadline to cancel an order?", relevantDocumentTitles: ["Order Cancellation"] },
    { query: "Can I cancel my order right after placing it?", relevantDocumentTitles: ["Order Cancellation"] },

    // -- Paiement (+2, 5 total)
    { query: "Do you take Visa or Mastercard?", relevantDocumentTitles: ["Accepted Payment Methods"] },
    { query: "Is cash on delivery available everywhere?", relevantDocumentTitles: ["Accepted Payment Methods"] },

    // -- Tracking (+3, 4 total)
    { query: "Where's my order right now?", relevantDocumentTitles: ["How to Track an Order"] },
    { query: "I didn't get a tracking link, what do I do?", relevantDocumentTitles: ["How to Track an Order"] },
    { query: "Can I see my order status without checking email?", relevantDocumentTitles: ["How to Track an Order"] },

    // -- Codes promo (+2, 4 total)
    { query: "My discount code says it's invalid", relevantDocumentTitles: ["Promo Code Troubleshooting"] },
    { query: "Why isn't my coupon applying to my cart?", relevantDocumentTitles: ["Promo Code Troubleshooting"] },

    // -- Support (+2, 3 total)
    { query: "When can I reach customer service?", relevantDocumentTitles: ["Customer Support Hours"] },
    { query: "Is support available on weekends?", relevantDocumentTitles: ["Customer Support Hours"] },

    // -- Multi-documents (+5, 6 total with the V1 shipping/customs query
    // above) — deliberately probes the three document boundaries named in
    // this étape's brief, rather than leaving them to be discovered by
    // accident the way Order Cancellation/Returns and Refunds was in 10.1.
    {
      // Ambiguous by design, documented rather than silently decided:
      // Order Cancellation's own content redirects to Returns and Refunds
      // once the cancellation window has passed ("it can still be
      // returned once delivered under our standard returns policy") — a
      // customer asking this could legitimately still be inside the
      // cancellation window (answer: Order Cancellation) or past it
      // (answer: Returns and Refunds). Both documents are genuinely
      // correct answers depending on timing the query itself doesn't
      // specify, so both are labeled relevant rather than picking one.
      query: "Can I cancel my order and get a refund instead?",
      relevantDocumentTitles: ["Order Cancellation", "Returns and Refunds"],
    },
    {
      // Compositional, not ambiguous: this genuinely needs facts from two
      // independent documents (which payment methods exist, and how promo
      // codes behave) that don't reference each other — unlike the
      // cancellation/refund case above, there's no single-document answer
      // being obscured here.
      query: "Can I combine a discount code with cash on delivery?",
      relevantDocumentTitles: ["Promo Code Troubleshooting", "Accepted Payment Methods"],
    },
    {
      query: "If I'm outside the country, how long until my order ships and arrives?",
      relevantDocumentTitles: ["Shipping Times", "International Shipping and Customs"],
    },
    {
      // Ambiguous by design, same underlying gap as "Can I cancel my
      // order and get a refund instead?" above, from a different angle:
      // "before it even ships" doesn't guarantee the customer is still
      // inside Order Cancellation's 1-hour free-cancellation window (real
      // fulfillment can easily take longer than that before shipping) —
      // exposing a genuine gap in the underlying policy documents
      // themselves (what applies between the 1-hour mark and actual
      // shipment is never stated), not just a labeling ambiguity. Both
      // documents are the best available answer; flagged here rather than
      // silently resolved.
      query: "I want to return my order before it even ships",
      relevantDocumentTitles: ["Order Cancellation", "Returns and Refunds"],
    },
    {
      query: "Can I use a promo code and still pay when the order arrives?",
      relevantDocumentTitles: ["Promo Code Troubleshooting", "Accepted Payment Methods"],
    },

    // -- Reformulations/synonymes (+5) — same intents already covered
    // above, deliberately reworded with different vocabulary rather than
    // just different syntax, so they add diagnostic value instead of
    // duplicating an existing query.
    { query: "How fast can I get my stuff?", relevantDocumentTitles: ["Shipping Times"] },
    { query: "I don't want this anymore, can I send it back?", relevantDocumentTitles: ["Returns and Refunds"] },
    { query: "Got a code that won't work at checkout", relevantDocumentTitles: ["Promo Code Troubleshooting"] },
    { query: "Need to know when you're open for questions", relevantDocumentTitles: ["Customer Support Hours"] },
    { query: "Any way to pay without a card?", relevantDocumentTitles: ["Accepted Payment Methods"] },

    // -- Requêtes courtes (+4) — fragmentary, the way an impatient
    // customer might actually type rather than a full sentence.
    { query: "Shipping time?", relevantDocumentTitles: ["Shipping Times"] },
    { query: "Cancel order?", relevantDocumentTitles: ["Order Cancellation"] },
    { query: "Track order", relevantDocumentTitles: ["How to Track an Order"] },
    { query: "Support hours?", relevantDocumentTitles: ["Customer Support Hours"] },

    // -- Sans document pertinent attendu (+4, 5 total with the V1 query
    // above) — plausible e-commerce questions this knowledge base
    // genuinely doesn't cover, not just absurd ones. A harder test of
    // MIN_RELEVANCE_SCORE's precision than "same-day delivery in another
    // galaxy" alone: nothing in these 8 documents should score high
    // enough to pass the threshold for any of them.
    { query: "Do you offer gift wrapping?", relevantDocumentTitles: [] },
    { query: "Can I change the delivery address after placing an order?", relevantDocumentTitles: [] },
    { query: "Do you have a loyalty or rewards program?", relevantDocumentTitles: [] },
    { query: "Can I get an invoice for my business?", relevantDocumentTitles: [] },
  ],
};
