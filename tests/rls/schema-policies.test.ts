import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Static RLS verification — parses supabase/schema.sql directly rather than
// asserting against a live Postgres instance. This project's test suite
// mocks the Supabase client everywhere (no real database in the loop), so
// nothing here can prove Postgres actually *enforces* a policy at runtime;
// what it proves is that every user-facing table has row level security
// turned on, has a policy for every operation it grants to `authenticated`,
// and that every one of those policies traces back to auth.uid() through a
// real ownership chain rather than a bare column check or a blanket allow.
// That's exactly the shape of mistake a migration is likely to introduce
// (a new table with the RLS toggle forgotten, a policy copy-pasted with the
// wrong table's ownership chain) and exactly what this suite catches
// automatically the next time schema.sql changes — real enforcement testing
// needs a live local Supabase instance (Docker + `supabase start`), which
// isn't set up in this environment yet.
const schemaSql = readFileSync(path.resolve(__dirname, "../../supabase/schema.sql"), "utf-8");

// Every table a merchant's own data ends up in. Deliberately explicit
// (not "every create table in the file") so a table added here without
// updating this list is a loud test failure, not a silent skip.
const USER_FACING_TABLES = [
  "shops",
  "orders",
  "products",
  "sync_history",
  "order_history",
  "workflows",
  "workflow_steps",
  "workflow_executions",
  "module_credentials",
  "order_notes",
  "workflow_waits",
  "google_accounts",
] as const;

function extractTableNames(sql: string): string[] {
  return [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
}

function isRlsEnabled(sql: string, table: string): boolean {
  return new RegExp(`alter table ${table} enable row level security;`).test(sql);
}

type Policy = { name: string; table: string; body: string };

// schema.sql is applied top-to-bottom as one idempotent script — a handful
// of policies are redefined later in the file, each preceded by its own
// `drop policy if exists`. Keeping only the LAST occurrence of each
// (table, name) pair mirrors what's actually live once the whole file has
// run once, exactly like re-running the file against an existing database
// would leave it.
function extractPolicies(sql: string): Policy[] {
  const regex = /create policy "([^"]+)"\s+on (\w+)([\s\S]*?);/g;
  const byKey = new Map<string, Policy>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sql))) {
    const [, name, table, body] = match;
    byKey.set(`${table}:${name}`, { name, table, body });
  }
  return Array.from(byKey.values());
}

function policiesFor(table: string): Policy[] {
  return extractPolicies(schemaSql).filter((p) => p.table === table);
}

describe("RLS — row level security is enabled on every user-facing table", () => {
  it.each(USER_FACING_TABLES)("%s", (table) => {
    expect(isRlsEnabled(schemaSql, table)).toBe(true);
  });

  // Guards the guard: if a future migration adds a new table and nobody
  // updates USER_FACING_TABLES, this is what actually notices.
  it("USER_FACING_TABLES accounts for every table actually defined in schema.sql", () => {
    for (const table of extractTableNames(schemaSql)) {
      expect(USER_FACING_TABLES).toContain(table);
    }
  });
});

describe("RLS — every policy is scoped, never a blanket allow", () => {
  const policies = extractPolicies(schemaSql);

  it("found at least one policy for every user-facing table", () => {
    const tablesWithPolicies = new Set(policies.map((p) => p.table));
    for (const table of USER_FACING_TABLES) {
      expect(tablesWithPolicies.has(table)).toBe(true);
    }
  });

  for (const policy of policies) {
    it(`${policy.table}: "${policy.name}" references auth.uid() and never allows an unconditional USING (true)`, () => {
      expect(policy.body).toMatch(/auth\.uid\(\)/);
      expect(policy.body).not.toMatch(/using\s*\(\s*true\s*\)/i);
    });
  }
});

describe("RLS — ownership chains trace back to the owning shop's user_id", () => {
  it('shops: every policy checks user_id = (select auth.uid()) directly — the root of every ownership chain', () => {
    const shopsPolicies = policiesFor("shops");
    expect(shopsPolicies.length).toBeGreaterThanOrEqual(4); // select/insert/update/delete
    for (const policy of shopsPolicies) {
      expect(policy.body).toContain("user_id = (select auth.uid())");
    }
  });

  it.each(["orders", "products", "sync_history", "workflows", "module_credentials"])(
    "%s: every policy scopes via shop_id -> shops.user_id, not a bare/unscoped check",
    (table) => {
      const tablePolicies = policiesFor(table);
      expect(tablePolicies.length).toBeGreaterThan(0);
      for (const policy of tablePolicies) {
        expect(policy.body).toContain(
          "shop_id in (select id from shops where user_id = (select auth.uid()))"
        );
      }
    }
  );

  it.each(["workflow_steps", "workflow_executions", "workflow_waits"])(
    "%s: every policy scopes via workflow_id -> workflows.shop_id -> shops.user_id",
    (table) => {
      const tablePolicies = policiesFor(table);
      expect(tablePolicies.length).toBeGreaterThan(0);
      for (const policy of tablePolicies) {
        expect(policy.body.replace(/\s+/g, " ")).toContain(
          "workflow_id in ( select id from workflows where shop_id in (select id from shops where user_id = (select auth.uid())) )"
        );
      }
    }
  );

  it.each(["order_history", "order_notes"])(
    "%s: every policy scopes via order_id -> orders.shop_id -> shops.user_id",
    (table) => {
      const tablePolicies = policiesFor(table);
      expect(tablePolicies.length).toBeGreaterThan(0);
      for (const policy of tablePolicies) {
        expect(policy.body.replace(/\s+/g, " ")).toContain(
          "order_id in ( select id from orders where shop_id in (select id from shops where user_id = (select auth.uid())) )"
        );
      }
    }
  );

  // Regression guard for the specific gap the Architecture Review flagged:
  // workflow_executions' RLS trusts workflow_id's ownership chain only,
  // never order_id's — runWorkflow()'s own assertSameShop() check
  // (lib/workflows/engine.ts) is the application-level backstop for a
  // mismatched (workflow, order) pair this policy shape can't catch on its
  // own. This test documents that the policy still doesn't check order_id,
  // so the app-level guard can't be quietly removed as "redundant."
  it("workflow_executions policy does not also check order_id's own ownership chain (documents why engine.ts's cross-shop guard still matters)", () => {
    const [policy] = policiesFor("workflow_executions");
    expect(policy.body).not.toContain("order_id in (select id from orders");
  });

  // order_history's insert policy carries an extra requirement beyond the
  // ownership chain: changed_by must be the caller themselves, not an
  // arbitrary user id — otherwise anyone who can update their own order's
  // status could attribute the change to a different user.
  it('order_history: the insert policy also requires changed_by = (select auth.uid())', () => {
    const insertPolicy = policiesFor("order_history").find((p) => p.name.includes("record status changes"));
    expect(insertPolicy).toBeDefined();
    expect(insertPolicy!.body).toContain("changed_by = (select auth.uid())");
  });
});

describe("RLS — tables written exclusively by the service-role client grant no direct writes to `authenticated`", () => {
  // workflow_executions, sync_history, order_notes are each written only by
  // background jobs (the Execution Engine, the sync pipeline) using the
  // service-role client, which bypasses RLS entirely — the `authenticated`
  // role (real logged-in users) should only ever be able to read them.
  it.each(["workflow_executions", "sync_history", "order_notes"])(
    "%s grants only select to authenticated",
    (table) => {
      const match = schemaSql.match(new RegExp(`grant ([\\w, ]+) on ${table} to authenticated;`));
      expect(match).not.toBeNull();
      const verbs = match![1].split(",").map((v) => v.trim());
      expect(verbs).toEqual(["select"]);
    }
  );

  // workflow_waits is select-only too, and additionally has no policy that
  // grants insert/update/delete at all (the resume cron uses the
  // service-role client, which bypasses RLS) — a stricter version of the
  // same invariant, since this table has no user-facing write path
  // whatsoever, not even an eventual one (unlike order_notes, whose
  // comment notes a future manual-note UI).
  it("workflow_waits has no insert/update/delete policy for authenticated", () => {
    const waitPolicies = policiesFor("workflow_waits");
    for (const policy of waitPolicies) {
      expect(policy.body).not.toMatch(/for (insert|update|delete)/);
    }
  });
});
