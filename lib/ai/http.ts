// Shared by every lib/ai/ provider that calls an external HTTP API directly
// (openrouter.ts, and now gemini.ts) — extracted here once a second
// provider needed the exact same abort-signal-combining logic
// openrouter.ts originally kept local to itself. Its own comment used to
// say "lib/ai/ is the only caller that needs one so far" — no longer true
// once a second provider existed, the same "extract once duplicated, not
// before" precedent already applied elsewhere in this project
// (lib/whatsapp-client.ts's isWhatsAppCredentials, tools/shared.ts's
// escapeLikePattern).
//
// Combines this call's own timeout with a caller-supplied cancellation
// signal into one signal fetch() can use.
export function buildAbortSignal(
  timeoutMs: number,
  external?: AbortSignal
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal;
  return { signal, clear: () => clearTimeout(timeout) };
}
