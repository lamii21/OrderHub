// Shared across tools/*/repository.ts modules — extracted once a second
// repository (promo-codes) needed the exact same ILIKE-escaping logic
// products/repository.ts introduced in Étape 6.2 (same "extract once
// duplicated, not before" precedent lib/platforms/retry.ts's own comment
// documents elsewhere in this project).
//
// Escapes ILIKE's own wildcard characters (% and _) and its escape
// character itself (\) in free-text input before it becomes part of a
// pattern — not a SQL injection concern (supabase-js parameterizes the
// value), but without this a search for e.g. "50% off" would have "%" act
// as a wildcard and match far more than was typed. Useful both for a
// substring search (wrapped in `%...%`) and for a case-insensitive exact
// match (used bare, no wildcards added) — either way, literal % / _ / \ in
// the input must never be interpreted as pattern syntax.
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
