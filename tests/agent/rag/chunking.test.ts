import { describe, it, expect } from "vitest";
import { chunkText, MAX_CHUNK_LENGTH } from "@/lib/agent/rag/chunking";

describe("chunkText — trivial inputs", () => {
  it("returns an empty array for empty content", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only content", () => {
    expect(chunkText("   \n\n   ")).toEqual([]);
  });

  it("returns the trimmed content as a single chunk when it already fits", () => {
    expect(chunkText("  Nous livrons partout au Maroc.  ")).toEqual(["Nous livrons partout au Maroc."]);
  });
});

describe("chunkText — paragraph packing", () => {
  it("merges short paragraphs into a single chunk when they fit together", () => {
    const content = "Premier paragraphe.\n\nDeuxième paragraphe.\n\nTroisième paragraphe.";
    expect(chunkText(content)).toEqual([content]);
  });

  it("splits into separate chunks once packing the next paragraph would exceed the limit", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const c = "c".repeat(40);
    const content = [a, b, c].join("\n\n");

    // With a limit smaller than any two paragraphs combined, each
    // paragraph must land in its own chunk.
    const result = chunkText(content, 50);

    expect(result).toEqual([a, b, c]);
  });

  it("packs as many consecutive paragraphs as fit before starting a new chunk", () => {
    const a = "a".repeat(20);
    const b = "b".repeat(20);
    const c = "c".repeat(20);
    const content = [a, b, c].join("\n\n");

    // a+b (20+2+20=42) fits under 45; adding c (42+2+20=64) would not.
    const result = chunkText(content, 45);

    expect(result).toEqual([`${a}\n\n${b}`, c]);
  });

  it("never returns a chunk longer than the given limit", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraphe numéro ${i} avec un peu de texte.`);
    const result = chunkText(paragraphs.join("\n\n"), 60);

    expect(result.every((chunk) => chunk.length <= 60)).toBe(true);
    // No content lost: every paragraph's own text is still present somewhere.
    expect(result.join("\n\n")).toEqual(expect.stringContaining(paragraphs[0]));
    expect(result.join("\n\n")).toEqual(expect.stringContaining(paragraphs[9]));
  });
});

describe("chunkText — oversized single paragraph", () => {
  it("falls back to sentence boundaries when one paragraph alone exceeds the limit", () => {
    const sentence1 = "Les retours sont acceptés sous 14 jours.";
    const sentence2 = "Le produit doit être dans son emballage d'origine.";
    const sentence3 = "Les frais de retour restent à la charge du client.";
    const content = `${sentence1} ${sentence2} ${sentence3}`;

    const result = chunkText(content, 50);

    expect(result.every((chunk) => chunk.length <= 50)).toBe(true);
    // Joined with no separator: a sentence long enough to fall back to
    // fixed-size windows is reconstructed from adjacent pieces with no
    // gap between them (the inter-sentence space itself is consumed by
    // the split delimiter, not preserved in either piece).
    const reconstructed = result.join("");
    expect(reconstructed).toContain(sentence1);
    expect(reconstructed).toContain(sentence2);
    expect(reconstructed).toContain(sentence3);
  });

  it("falls back to fixed-size windows when there is no sentence punctuation at all", () => {
    const content = "x".repeat(230);

    const result = chunkText(content, 100);

    expect(result).toEqual([content.slice(0, 100), content.slice(100, 200), content.slice(200, 230)]);
    expect(result.every((chunk) => chunk.length <= 100)).toBe(true);
  });

  it("never drops or duplicates characters when falling back to fixed-size windows", () => {
    const content = "y".repeat(347);
    const result = chunkText(content, 100);

    expect(result.join("")).toBe(content);
  });
});

describe("chunkText — default limit", () => {
  it("uses MAX_CHUNK_LENGTH when no explicit limit is given", () => {
    const content = "z".repeat(MAX_CHUNK_LENGTH + 500);
    const result = chunkText(content);

    expect(result.every((chunk) => chunk.length <= MAX_CHUNK_LENGTH)).toBe(true);
    expect(result.join("")).toBe(content);
  });
});
