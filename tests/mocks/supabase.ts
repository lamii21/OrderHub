import { vi } from "vitest";

export type QueryResult = { data: unknown; error: unknown; count?: number | null };

export type MockSupabaseConfig = {
  // Keyed by table name. A single result is returned for every call to
  // .from(table); an array is treated as a queue (one result consumed per
  // call, the last entry repeating once exhausted) — lets a test simulate,
  // e.g., a first .from("orders") lookup returning null (no existing row)
  // followed by a second returning the inserted row.
  responses?: Record<string, QueryResult[] | QueryResult>;
  rpc?: Record<string, QueryResult[] | QueryResult>;
  user?: { id: string; email?: string; last_sign_in_at?: string } | null;
};

type MockFn = ReturnType<typeof vi.fn>;

// Exported so a test can type `builders.table[n]` precisely instead of
// hitting TypeScript's "Object is of type unknown" on `.insert.mock.calls`
// etc.
export type MockQueryBuilder = {
  __table: string;
  __calls: Record<string, unknown[][]>;
  select: MockFn;
  eq: MockFn;
  neq: MockFn;
  gt: MockFn;
  gte: MockFn;
  lt: MockFn;
  lte: MockFn;
  in: MockFn;
  is: MockFn;
  not: MockFn;
  order: MockFn;
  limit: MockFn;
  range: MockFn;
  returns: MockFn;
  insert: MockFn;
  update: MockFn;
  upsert: MockFn;
  delete: MockFn;
  single: MockFn;
  maybeSingle: MockFn;
  then: (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise<unknown>;
};

function nextResult(queue: QueryResult[], index: { n: number }): QueryResult {
  if (queue.length === 0) return { data: null, error: null };
  const i = Math.min(index.n, queue.length - 1);
  index.n += 1;
  return queue[i];
}

// A minimal, chainable stand-in for supabase-js's PostgrestQueryBuilder.
// Every filter/order/range method returns the same builder (real chains are
// never actually order-sensitive for what these tests assert), and the
// builder itself is thenable so `await supabase.from(x).select(y)` resolves
// without a trailing .single()/.maybeSingle(), exactly like the real client.
//
// `index` is shared across every builder created for the same table (see
// createMockSupabase) — a Server Action that calls .from("orders") twice
// (once to read, once to update) must advance through the same queue, not
// restart it each time.
function makeBuilder(table: string, queue: QueryResult[], index: { n: number }): MockQueryBuilder {
  const calls: Record<string, unknown[][]> = {};

  const record = (method: string, args: unknown[]) => {
    calls[method] ??= [];
    calls[method].push(args);
  };

  const chain = [
    "select",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "not",
    "order",
    "limit",
    "range",
    "returns",
  ] as const;

  const builder: Record<string, unknown> = { __table: table, __calls: calls };

  for (const method of chain) {
    builder[method] = vi.fn((...args: unknown[]) => {
      record(method, args);
      return builder;
    });
  }

  builder.insert = vi.fn((payload: unknown) => {
    record("insert", [payload]);
    return builder;
  });
  builder.update = vi.fn((payload: unknown) => {
    record("update", [payload]);
    return builder;
  });
  builder.upsert = vi.fn((payload: unknown, opts?: unknown) => {
    record("upsert", [payload, opts]);
    return builder;
  });
  builder.delete = vi.fn(() => {
    record("delete", []);
    return builder;
  });

  builder.single = vi.fn(async () => nextResult(queue, index));
  builder.maybeSingle = vi.fn(async () => nextResult(queue, index));

  // Thenable: lets `await builder` resolve the same way `.single()` does,
  // matching real supabase-js query builders (which are themselves
  // PromiseLike).
  builder.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(nextResult(queue, index)).then(onFulfilled, onRejected);

  return builder as MockQueryBuilder;
}

export function createMockSupabase(config: MockSupabaseConfig = {}) {
  const queues = new Map<string, QueryResult[]>();
  for (const [table, res] of Object.entries(config.responses ?? {})) {
    queues.set(table, Array.isArray(res) ? [...res] : [res]);
  }

  const rpcQueues = new Map<string, QueryResult[]>();
  for (const [fn, res] of Object.entries(config.rpc ?? {})) {
    rpcQueues.set(fn, Array.isArray(res) ? [...res] : [res]);
  }
  const rpcIndex = new Map<string, { n: number }>();
  const tableIndex = new Map<string, { n: number }>();

  const builders: Record<string, ReturnType<typeof makeBuilder>[]> = {};

  const client = {
    from: vi.fn((table: string) => {
      const queue = queues.get(table) ?? [];
      const idx = tableIndex.get(table) ?? { n: 0 };
      tableIndex.set(table, idx);
      const builder = makeBuilder(table, queue, idx);
      builders[table] ??= [];
      builders[table].push(builder);
      return builder;
    }),
    rpc: vi.fn(async (fnName: string) => {
      const queue = rpcQueues.get(fnName) ?? [];
      const idx = rpcIndex.get(fnName) ?? { n: 0 };
      rpcIndex.set(fnName, idx);
      return nextResult(queue, idx);
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: config.user ?? null } })),
    },
  };

  return {
    client,
    // Convenience for assertions: the most recent builder created for a
    // given table (covers the common case of one .from(table) call per
    // test; tests exercising multiple calls to the same table index into
    // builders[table] directly).
    builders,
    lastBuilder: (table: string) => {
      const list = builders[table];
      return list?.[list.length - 1];
    },
  };
}
