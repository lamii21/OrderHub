// Pure text chunking — no I/O, no randomness, deterministic: the same
// content in always produces the same chunks out, same "pure function
// boundary" discipline already applied to prompt/builder.ts and
// summary/builder.ts. Deliberately no overlap between consecutive chunks
// in this V1 — a real, known RAG quality technique, but real added
// complexity for content that (faq/policy/note) is typically short and
// self-contained; flagged as a deliberate simplification, not an
// oversight, revisit only if retrieval quality in practice shows chunk
// boundaries actually losing meaning.

// A real ceiling, not just a target: every chunk chunkText() returns is
// guaranteed at or under this length. splitOversizedUnit's three tiers
// each guarantee their own output units stay within it (the fixed-size
// window tier as a hard fallback), and packIntoChunks never adds a unit
// to an accumulator that would push it over — it flushes first.
export const MAX_CHUNK_LENGTH = 1000;

export function chunkText(content: string, maxLength: number = MAX_CHUNK_LENGTH): string[] {
  const paragraphs = splitOn(content, /\n\s*\n/);
  const units = paragraphs.flatMap((paragraph) => splitOversizedUnit(paragraph, maxLength));
  return packIntoChunks(units, maxLength);
}

// Three-tier fallback, each tier only engaged if the previous one couldn't
// bring a unit under the target: paragraph -> sentence -> fixed-size
// window. Most real content (a FAQ answer, a short policy paragraph) never
// reaches past tier one. Recursion always terminates: a unit that splits
// into more than one sentence is, by construction, split into strictly
// smaller pieces than itself.
function splitOversizedUnit(unit: string, maxLength: number): string[] {
  if (unit.length <= maxLength) {
    return [unit];
  }

  const sentences = splitOn(unit, /(?<=[.!?])\s+/);

  if (sentences.length > 1) {
    return sentences.flatMap((sentence) => splitOversizedUnit(sentence, maxLength));
  }

  // No paragraph break, no sentence-ending punctuation either — nothing
  // linguistic left to split on. The only tier where a boundary can land
  // inside a word; accepted, since there is no better option left.
  return splitByLength(unit, maxLength);
}

function splitOn(text: string, pattern: RegExp): string[] {
  return text
    .split(pattern)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
}

function splitByLength(text: string, maxLength: number): string[] {
  const pieces: string[] = [];

  for (let start = 0; start < text.length; start += maxLength) {
    pieces.push(text.slice(start, start + maxLength));
  }

  return pieces;
}

// Greedily concatenates consecutive units (paragraphs, or the smaller
// pieces splitOversizedUnit produced) up to maxLength, joined by a blank
// line — every unit coming in is already guaranteed <= maxLength on its
// own, so a chunk only ever grows by adding a unit when the result still
// fits; otherwise the accumulator is flushed first and the unit starts the
// next chunk instead.
function packIntoChunks(units: string[], maxLength: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];

  for (const unit of units) {
    const candidate = [...current, unit].join("\n\n");

    if (current.length > 0 && candidate.length > maxLength) {
      chunks.push(current.join("\n\n"));
      current = [unit];
      continue;
    }

    current = [...current, unit];
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks;
}
