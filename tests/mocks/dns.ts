import { lookup } from "node:dns/promises";

// node:dns/promises's lookup() is overloaded — a plain call returns a
// single LookupAddress, and only the { all: true } form (the one
// lib/net-guard.ts always uses) returns LookupAddress[]. vi.mocked(lookup)
// resolves to a signature that rejects an array being passed to
// mockResolvedValue, even though every test here is mocking exactly the
// { all: true } call shape. This is the one place that ambiguity is
// resolved (via a cast, since fighting the overload set's exact generic
// shape isn't worth it for a test-only mock) — every test file that needs
// to drive DNS resolution results imports this instead of typing its own
// vi.mocked(lookup).
export const mockedLookup = lookup as unknown as {
  mockResolvedValue: (value: { address: string; family: number }[]) => void;
  mockRejectedValue: (value: unknown) => void;
  mockClear: () => void;
};
