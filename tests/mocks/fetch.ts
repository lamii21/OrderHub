import { vi } from "vitest";

export type MockFetchResponse = {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  json?: () => unknown | Promise<unknown>;
  text?: () => string | Promise<string>;
};

// Stands in for every external HTTP provider this project calls directly
// with the global fetch() (WhatsApp Cloud API, Resend, a generic delivery
// webhook, an automation Webhook step, the platform connectors' own REST
// calls, ...). One queued response per call, the last one repeating once
// exhausted — mirrors createMockSupabase's queueing so both mocks read the
// same way in a test.
export function mockFetchSequence(responses: MockFetchResponse[]) {
  let index = 0;

  const fetchMock = vi.fn(async (..._args: unknown[]) => {
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;

    const headerMap = new Map(Object.entries(next.headers ?? {}));

    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
      json: async () => (next.json ? next.json() : {}),
      text: async () => (next.text ? next.text() : ""),
    };
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}
