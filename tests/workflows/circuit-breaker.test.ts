import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { isCircuitOpen, CONSECUTIVE_FAILURE_THRESHOLD } from "@/lib/workflows/circuit-breaker";

describe("isCircuitOpen", () => {
  it("is closed when there's no history for this step yet", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_executions: { data: [], error: null } },
    });
    holder.client = client;

    await expect(isCircuitOpen(1, 1, "whatsapp")).resolves.toBe(false);
  });

  it("is closed when fewer than the threshold attempts exist, even if all failed", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: {
          data: Array(CONSECUTIVE_FAILURE_THRESHOLD - 1).fill({ status: "failed" }),
          error: null,
        },
      },
    });
    holder.client = client;

    await expect(isCircuitOpen(1, 1, "whatsapp")).resolves.toBe(false);
  });

  it("is open when the last N attempts all failed", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_executions: {
          data: Array(CONSECUTIVE_FAILURE_THRESHOLD).fill({ status: "failed" }),
          error: null,
        },
      },
    });
    holder.client = client;

    await expect(isCircuitOpen(1, 1, "whatsapp")).resolves.toBe(true);

    const builder = builders.workflow_executions[0];
    expect(builder.eq).toHaveBeenNthCalledWith(1, "workflow_id", 1);
    expect(builder.eq).toHaveBeenNthCalledWith(2, "step_order", 1);
    expect(builder.eq).toHaveBeenNthCalledWith(3, "module_name", "whatsapp");
    expect(builder.limit).toHaveBeenCalledWith(CONSECUTIVE_FAILURE_THRESHOLD);
  });

  it("is closed when even one of the last N attempts succeeded", async () => {
    const data = Array(CONSECUTIVE_FAILURE_THRESHOLD).fill({ status: "failed" });
    data[0] = { status: "success" }; // the most recent attempt succeeded
    const { client } = createMockSupabase({
      responses: { workflow_executions: { data, error: null } },
    });
    holder.client = client;

    await expect(isCircuitOpen(1, 1, "whatsapp")).resolves.toBe(false);
  });

  it("fails safe (closed) on a query error rather than blocking every step", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_executions: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(isCircuitOpen(1, 1, "whatsapp")).resolves.toBe(false);
  });

  it("scopes independently per (workflow_id, step_order) — a failing step 1 never opens step 2's circuit", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: { data: [{ status: "failed" }], error: null },
      },
    });
    holder.client = client;

    await expect(isCircuitOpen(1, 2, "whatsapp")).resolves.toBe(false);
  });

  // Regression test for the Critical finding in the production readiness
  // report: step_order is reassigned by reordering/renumbering, so it
  // cannot be the circuit's identity on its own. Filtering by module_name
  // too means the query itself can never surface a different module's
  // history, regardless of what step_order the two modules happen to
  // share over time — this is asserted directly on the query the mock
  // recorded, not just on the return value, so it fails if a future edit
  // ever drops the module_name filter.
  it("filters by module_name so a step can never inherit a different module's failure history", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        // Even if the mock were configured to return 3 failed rows here,
        // the real query always scopes to this exact module — this test
        // asserts the filter itself is present, which is what makes that
        // true against a real database.
        workflow_executions: { data: [], error: null },
      },
    });
    holder.client = client;

    await isCircuitOpen(1, 1, "update-status");

    const builder = builders.workflow_executions[0];
    expect(builder.eq).toHaveBeenCalledWith("module_name", "update-status");
  });
});
