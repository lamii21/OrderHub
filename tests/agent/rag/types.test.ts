import { describe, it, expect } from "vitest";
import { isRagDocumentType } from "@/lib/agent/rag/types";

describe("isRagDocumentType", () => {
  it("accepts every value in RAG_DOCUMENT_TYPES", () => {
    expect(isRagDocumentType("faq")).toBe(true);
    expect(isRagDocumentType("policy")).toBe(true);
    expect(isRagDocumentType("pdf")).toBe(true);
    expect(isRagDocumentType("note")).toBe(true);
  });

  it("rejects an unknown string, including a plausible-looking one like 'product'", () => {
    expect(isRagDocumentType("product")).toBe(false);
    expect(isRagDocumentType("")).toBe(false);
    expect(isRagDocumentType("FAQ")).toBe(false);
  });
});
