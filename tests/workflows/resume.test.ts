import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { persistWorkflowWait, getDueWorkflowWaits, claimWorkflowWait } from "@/lib/workflows/resume";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("persistWorkflowWait", () => {
  it("inserts a wait row with the resume point, context, and resume_at as ISO", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflow_waits: { data: null, error: null } },
    });
    holder.client = client;

    await persistWorkflowWait({
      workflowId: 1,
      orderId: 100,
      resumeStepId: 9,
      context: { delay: { durationMs: 1000 } },
      resumeAt: new Date("2026-01-01T00:30:00.000Z"),
    });

    expect(builders.workflow_waits[0].insert).toHaveBeenCalledWith({
      workflow_id: 1,
      order_id: 100,
      resume_step_id: 9,
      context: { delay: { durationMs: 1000 } },
      resume_at: "2026-01-01T00:30:00.000Z",
    });
  });

  it("logs and does not throw when the insert fails", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_waits: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(
      persistWorkflowWait({
        workflowId: 1,
        orderId: 100,
        resumeStepId: 9,
        context: {},
        resumeAt: new Date(),
      })
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("getDueWorkflowWaits", () => {
  it("filters to unconsumed, due waits, oldest first, capped at the given limit", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflow_waits: { data: [{ id: 1 }], error: null } },
    });
    holder.client = client;

    await getDueWorkflowWaits(50);

    const builder = builders.workflow_waits[0];
    expect(builder.is).toHaveBeenCalledWith("consumed_at", null);
    expect(builder.lte).toHaveBeenCalledWith("resume_at", expect.any(String));
    expect(builder.order).toHaveBeenCalledWith("resume_at", { ascending: true });
    expect(builder.limit).toHaveBeenCalledWith(50);
  });

  it("returns an empty array (not null) on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_waits: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(getDueWorkflowWaits(50)).resolves.toEqual([]);
  });
});

describe("claimWorkflowWait", () => {
  it("claims successfully when the update affects a row (still unconsumed)", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflow_waits: { data: [{ id: 7 }], error: null } },
    });
    holder.client = client;

    await expect(claimWorkflowWait(7)).resolves.toBe(true);

    const builder = builders.workflow_waits[0];
    expect(builder.update).toHaveBeenCalledWith({ consumed_at: expect.any(String) });
    expect(builder.eq).toHaveBeenCalledWith("id", 7);
    expect(builder.is).toHaveBeenCalledWith("consumed_at", null);
  });

  // Regression-style guard for the idempotency guarantee: a second,
  // overlapping cron invocation racing for the same wait must see 0
  // affected rows (already consumed by the first) and back off instead of
  // resuming the workflow a second time.
  it("fails to claim when the row was already consumed (0 rows affected)", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_waits: { data: [], error: null } },
    });
    holder.client = client;

    await expect(claimWorkflowWait(7)).resolves.toBe(false);
  });

  it("fails safe (does not claim) on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_waits: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(claimWorkflowWait(7)).resolves.toBe(false);
  });
});
