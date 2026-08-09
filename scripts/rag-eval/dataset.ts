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
  ],
};
