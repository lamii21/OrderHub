import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const { runWorkflow, isCircuitOpen } = vi.hoisted(() => ({
  runWorkflow: vi.fn(),
  isCircuitOpen: vi.fn(),
}));

vi.mock("@/lib/workflows/engine", () => ({ runWorkflow }));
vi.mock("@/lib/workflows/circuit-breaker", () => ({
  isCircuitOpen,
  CONSECUTIVE_FAILURE_THRESHOLD: 3,
}));

import { retryWorkflowExecutions, getBackoffEligiblePairs } from "@/lib/workflows/retry";

beforeEach(() => {
  runWorkflow.mockReset().mockResolvedValue(undefined);
  isCircuitOpen.mockReset().mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("retryWorkflowExecutions", () => {
  it("returns 0 and touches nothing when there are no pairs to retry", async () => {
    const { client, builders } = createMockSupabase();

    const retried = await retryWorkflowExecutions(client as never, []);

    expect(retried).toBe(0);
    expect(builders.workflows).toBeUndefined();
  });

  it("retries each pair once, skipping already-succeeded steps", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: [{ id: 1, name: "A", workflow_steps: [] }],
          error: null,
        },
        orders: { data: [{ id: 100 }], error: null },
        workflow_executions: {
          data: [{ workflow_id: 1, order_id: 100, step_order: 1 }],
          error: null,
        },
      },
    });

    const retried = await retryWorkflowExecutions(client as never, [{ workflow_id: 1, order_id: 100 }]);

    expect(retried).toBe(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 100 }),
      { skipStepOrders: new Set([1]) }
    );
  });

  it("also skips the extra step orders the caller provides, unioned with already-succeeded ones", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: { data: [{ id: 1, name: "A", workflow_steps: [] }], error: null },
        orders: { data: [{ id: 100 }], error: null },
        workflow_executions: {
          data: [{ workflow_id: 1, order_id: 100, step_order: 1 }],
          error: null,
        },
      },
    });

    await retryWorkflowExecutions(
      client as never,
      [{ workflow_id: 1, order_id: 100 }],
      new Map([["1:100", new Set([2])]])
    );

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { skipStepOrders: new Set([1, 2]) }
    );
  });

  it("passes skipStepOrders: undefined (not an empty Set) when nothing is skipped", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: { data: [{ id: 1, name: "A", workflow_steps: [] }], error: null },
        orders: { data: [{ id: 100 }], error: null },
        workflow_executions: { data: [], error: null },
      },
    });

    await retryWorkflowExecutions(client as never, [{ workflow_id: 1, order_id: 100 }]);

    expect(runWorkflow).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      skipStepOrders: undefined,
    });
  });

  it("skips a pair when the workflow or order no longer exists", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: { data: [], error: null },
        orders: { data: [{ id: 100 }], error: null },
        workflow_executions: { data: [], error: null },
      },
    });

    const retried = await retryWorkflowExecutions(client as never, [{ workflow_id: 1, order_id: 100 }]);

    expect(retried).toBe(0);
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("does not let one failing retry stop the others", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: [
            { id: 1, name: "A", workflow_steps: [] },
            { id: 2, name: "B", workflow_steps: [] },
          ],
          error: null,
        },
        orders: { data: [{ id: 100 }, { id: 200 }], error: null },
        workflow_executions: { data: [], error: null },
      },
    });
    runWorkflow.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);

    const retried = await retryWorkflowExecutions(client as never, [
      { workflow_id: 1, order_id: 100 },
      { workflow_id: 2, order_id: 200 },
    ]);

    expect(retried).toBe(1);
    expect(runWorkflow).toHaveBeenCalledTimes(2);
  });

  it("returns 0 without retrying anything on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: null, error: { message: "db down" } } },
    });

    const retried = await retryWorkflowExecutions(client as never, [{ workflow_id: 1, order_id: 100 }]);

    expect(retried).toBe(0);
    expect(runWorkflow).not.toHaveBeenCalled();
  });
});

describe("getBackoffEligiblePairs", () => {
  it("returns no pairs when nothing has failed recently", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_executions: { data: [], error: null } },
    });

    const result = await getBackoffEligiblePairs(client as never, 24 * 60 * 60 * 1000);

    expect(result.pairs).toEqual([]);
    expect(result.skipStepOrdersByPair.size).toBe(0);
  });

  it("is eligible once the backoff window has elapsed since a single failure", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: {
          data: [
            {
              workflow_id: 1,
              order_id: 100,
              step_order: 1,
              module_name: "whatsapp",
              started_at: new Date(Date.now() - 6 * 60_000).toISOString(), // 6 min ago
            },
          ],
          error: null,
        },
      },
    });

    const result = await getBackoffEligiblePairs(client as never, 24 * 60 * 60 * 1000);

    expect(result.pairs).toEqual([{ workflow_id: 1, order_id: 100 }]);
    expect(result.skipStepOrdersByPair.size).toBe(0);
  });

  it("is NOT eligible before the backoff window has elapsed since a single failure", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: {
          data: [
            {
              workflow_id: 1,
              order_id: 100,
              step_order: 1,
              module_name: "whatsapp",
              started_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
            },
          ],
          error: null,
        },
      },
    });

    const result = await getBackoffEligiblePairs(client as never, 24 * 60 * 60 * 1000);

    expect(result.pairs).toEqual([]);
    expect(result.skipStepOrdersByPair.get("1:100")).toEqual(new Set([1]));
  });

  it("uses the longer backoff window after a 2nd failure", async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: {
          data: [
            { workflow_id: 1, order_id: 100, step_order: 1, module_name: "whatsapp", started_at: tenMinAgo },
            { workflow_id: 1, order_id: 100, step_order: 1, module_name: "whatsapp", started_at: tenMinAgo },
          ],
          error: null,
        },
      },
    });

    // 10 minutes since the 2nd failure is past the 5-minute window but
    // short of the 30-minute one that now applies.
    const result = await getBackoffEligiblePairs(client as never, 24 * 60 * 60 * 1000);

    expect(result.pairs).toEqual([]);
    expect(result.skipStepOrdersByPair.get("1:100")).toEqual(new Set([1]));
  });

  it("never selects a step whose circuit is open, regardless of backoff timing", async () => {
    isCircuitOpen.mockResolvedValue(true);
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: {
          data: [
            {
              workflow_id: 1,
              order_id: 100,
              step_order: 1,
              module_name: "whatsapp",
              started_at: new Date(Date.now() - 60 * 60_000).toISOString(), // 1h ago — well past any backoff
            },
          ],
          error: null,
        },
      },
    });

    const result = await getBackoffEligiblePairs(client as never, 24 * 60 * 60 * 1000);

    expect(result.pairs).toEqual([]);
    expect(result.skipStepOrdersByPair.get("1:100")).toEqual(new Set([1]));
  });

  it("includes a pair once ANY of its failed steps is eligible, and skips only the ineligible ones", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: {
          data: [
            // step 1: eligible (6 min ago, single failure)
            {
              workflow_id: 1,
              order_id: 100,
              step_order: 1,
              module_name: "whatsapp",
              started_at: new Date(Date.now() - 6 * 60_000).toISOString(),
            },
            // step 2: not yet eligible (just failed)
            {
              workflow_id: 1,
              order_id: 100,
              step_order: 2,
              module_name: "email",
              started_at: new Date().toISOString(),
            },
          ],
          error: null,
        },
      },
    });

    const result = await getBackoffEligiblePairs(client as never, 24 * 60 * 60 * 1000);

    expect(result.pairs).toEqual([{ workflow_id: 1, order_id: 100 }]);
    expect(result.skipStepOrdersByPair.get("1:100")).toEqual(new Set([2]));
  });

  it("returns no pairs on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_executions: { data: null, error: { message: "db down" } } },
    });

    const result = await getBackoffEligiblePairs(client as never, 24 * 60 * 60 * 1000);

    expect(result.pairs).toEqual([]);
  });
});
