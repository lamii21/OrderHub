// Small, self-contained lists for the two General Settings fields that
// don't have a canonical source elsewhere in this app yet (currency,
// timezone). Neither is read by any existing display/computation — see the
// Store Settings feature notes for why that's deliberate, not a gap.
export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "MAD",
  "CAD",
  "AUD",
  "CHF",
  "JPY",
  "CNY",
  "AED",
] as const;

// The IANA timezone list straight from the JS runtime — no hardcoded list to
// maintain, and it's the same database every browser/platform already uses.
export function getTimezones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}
