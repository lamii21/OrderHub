import { describe, it, expect } from "vitest";
import { normalizeRagQuery } from "@/lib/agent/rag/query-normalization";

describe("normalizeRagQuery — bare hash references", () => {
  it("strips a standalone #123 reference", () => {
    expect(normalizeRagQuery("#123")).toBe("");
  });

  it("strips #123 out of a surrounding sentence", () => {
    expect(normalizeRagQuery("What is the status of #123?")).toBe("What is the status of ?");
  });
});

describe("normalizeRagQuery — keyword-anchored references", () => {
  it("strips 'order #123'", () => {
    expect(normalizeRagQuery("order #123")).toBe("order");
  });

  it("strips 'order 123' (no hash)", () => {
    expect(normalizeRagQuery("order 123")).toBe("order");
  });

  it("strips 'order number 123'", () => {
    expect(normalizeRagQuery("order number 123")).toBe("order");
  });

  it("strips 'customer 123'", () => {
    expect(normalizeRagQuery("customer 123")).toBe("customer");
  });

  it("strips 'invoice 123'", () => {
    expect(normalizeRagQuery("invoice 123")).toBe("invoice");
  });

  it("strips 'order#123' with no space before the hash", () => {
    expect(normalizeRagQuery("order#123")).toBe("order");
  });
});

describe("normalizeRagQuery — case insensitivity", () => {
  it("matches the keyword regardless of case and preserves the original casing", () => {
    expect(normalizeRagQuery("Order #123")).toBe("Order");
    expect(normalizeRagQuery("ORDER 123")).toBe("ORDER");
    expect(normalizeRagQuery("Customer Number 456")).toBe("Customer");
  });
});

describe("normalizeRagQuery — multiple references in one query", () => {
  it("strips every structured reference, not just the first", () => {
    expect(normalizeRagQuery("Customer #88, order #3341 - my promo code isn't applying, why?")).toBe(
      "Customer, order - my promo code isn't applying, why?"
    );
  });

  it("strips a mix of hash-only and keyword-anchored references", () => {
    expect(normalizeRagQuery("Order #5567 and also #9999 for reference")).toBe("Order and also for reference");
  });
});

describe("normalizeRagQuery — realistic composed queries", () => {
  it("recovers the bare documentary question from an order-tagged refund query", () => {
    expect(normalizeRagQuery("What is the refund policy for my order #4521?")).toBe(
      "What is the refund policy for my order?"
    );
  });

  it("recovers the bare documentary question from a customer-tagged cancellation query", () => {
    expect(normalizeRagQuery("I'm customer #12, what's your cancellation policy?")).toBe(
      "I'm customer, what's your cancellation policy?"
    );
  });
});

describe("normalizeRagQuery — semantically meaningful numbers are preserved", () => {
  it("does not strip a bare year not anchored to a structured keyword", () => {
    expect(normalizeRagQuery("What is your return policy for products purchased after 2024?")).toBe(
      "What is your return policy for products purchased after 2024?"
    );
  });

  it("does not strip a bare dollar amount not anchored to a structured keyword", () => {
    expect(normalizeRagQuery("What are the shipping rules for orders over $500?")).toBe(
      "What are the shipping rules for orders over $500?"
    );
  });

  it("does not strip a bare duration not anchored to a structured keyword", () => {
    expect(normalizeRagQuery("Can I return an item within 30 days?")).toBe(
      "Can I return an item within 30 days?"
    );
  });
});

describe("normalizeRagQuery — trivial inputs", () => {
  it("returns an empty string unchanged", () => {
    expect(normalizeRagQuery("")).toBe("");
  });

  it("leaves a query with no structured reference completely untouched", () => {
    expect(normalizeRagQuery("What is your refund policy?")).toBe("What is your refund policy?");
  });

  it("trims surrounding whitespace left over after stripping", () => {
    expect(normalizeRagQuery("  order #123  ")).toBe("order");
  });
});
