import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import {
  recordWorkflowExecution,
  getExecutionsForOrder,
  getRecentExecutionsForWorkflow,
  getExecutionStatsForWorkflow,
  latestExecutionByOrderId,
  uniqueByWorkflowAndOrder,
} from "@/lib/workflows/execution-history";

describe("recordWorkflowExecution", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("computes duration_ms from startedAt and inserts a success row", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(new Date("2026-01-01T00:00:00.750Z"));

    const { client, builders } = createMockSupabase({
      responses: { workflow_executions: { data: null, error: null } },
    });
    holder.client = client;

    await recordWorkflowExecution({
      workflowId: 1,
      orderId: 2,
      stepOrder: 1,
      moduleName: "archive",
      startedAt,
      status: "success",
    });

    expect(builders.workflow_executions[0].insert).toHaveBeenCalledWith({
      workflow_id: 1,
      order_id: 2,
      step_order: 1,
      module_name: "archive",
      status: "success",
      message: null,
      duration_ms: 750,
      started_at: startedAt.toISOString(),
    });

    vi.useRealTimers();
  });

  it("stores the provided message on a failure", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflow_executions: { data: null, error: null } },
    });
    holder.client = client;

    await recordWorkflowExecution({
      workflowId: 1,
      orderId: 2,
      stepOrder: 1,
      moduleName: "whatsapp",
      startedAt: new Date(),
      status: "failed",
      message: "No credentials configured.",
    });

    expect(builders.workflow_executions[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", message: "No credentials configured." })
    );
  });

  it("logs but never throws when the insert itself fails", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_executions: { data: null, error: { message: "insert failed" } } },
    });
    holder.client = client;

    await expect(
      recordWorkflowExecution({
        workflowId: 1,
        orderId: 2,
        stepOrder: 1,
        moduleName: "archive",
        startedAt: new Date(),
        status: "success",
      })
    ).resolves.toBeUndefined();
  });
});

describe("getExecutionsForOrder", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("queries by order_id, newest first, joined with the workflow's name", async () => {
    const rows = [
      {
        id: 2,
        workflow_id: 1,
        order_id: 100,
        step_order: 1,
        module_name: "archive",
        status: "success",
        message: null,
        duration_ms: 5,
        started_at: "2026-01-02T00:00:00Z",
        workflows: { name: "Auto-archive" },
      },
    ];
    const { client, builders } = createMockSupabase({
      responses: { workflow_executions: { data: rows, error: null } },
    });
    holder.client = client;

    const result = await getExecutionsForOrder(100);

    expect(result).toEqual(rows);
    const builder = builders.workflow_executions[0];
    expect(builder.eq).toHaveBeenCalledWith("order_id", 100);
    expect(builder.order).toHaveBeenCalledWith("started_at", { ascending: false });
  });

  it("returns an empty array (not an error) on a query failure", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_executions: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(getExecutionsForOrder(100)).resolves.toEqual([]);
  });
});

describe("getRecentExecutionsForWorkflow", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("queries by workflow_id, newest first, capped at the default limit of 15", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflow_executions: { data: [], error: null } },
    });
    holder.client = client;

    await getRecentExecutionsForWorkflow(5);

    const builder = builders.workflow_executions[0];
    expect(builder.eq).toHaveBeenCalledWith("workflow_id", 5);
    expect(builder.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(15);
  });

  it("respects a custom limit", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflow_executions: { data: [], error: null } },
    });
    holder.client = client;

    await getRecentExecutionsForWorkflow(5, 3);

    expect(builders.workflow_executions[0].limit).toHaveBeenCalledWith(3);
  });

  it("returns an empty array (not an error) on a query failure", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_executions: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(getRecentExecutionsForWorkflow(5)).resolves.toEqual([]);
  });
});

describe("getExecutionStatsForWorkflow", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("computes successCount/failureCount/successRate from 2 head-count queries", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_executions: [
          { data: null, error: null, count: 10 }, // total
          { data: null, error: null, count: 7 }, // success
        ],
      },
    });
    holder.client = client;

    const stats = await getExecutionStatsForWorkflow(5);

    expect(stats).toEqual({
      totalExecutions: 10,
      successCount: 7,
      failureCount: 3,
      successRate: 70,
    });
    expect(builders.workflow_executions[0].eq).toHaveBeenCalledWith("workflow_id", 5);
    expect(builders.workflow_executions[1].eq).toHaveBeenNthCalledWith(1, "workflow_id", 5);
    expect(builders.workflow_executions[1].eq).toHaveBeenNthCalledWith(2, "status", "success");
  });

  it("returns a null successRate (not 0 or NaN) when there are no executions yet", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: [
          { data: null, error: null, count: 0 },
          { data: null, error: null, count: 0 },
        ],
      },
    });
    holder.client = client;

    const stats = await getExecutionStatsForWorkflow(5);

    expect(stats).toEqual({
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      successRate: null,
    });
  });

  it("rounds successRate to one decimal place", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: [
          { data: null, error: null, count: 3 },
          { data: null, error: null, count: 1 },
        ],
      },
    });
    holder.client = client;

    const stats = await getExecutionStatsForWorkflow(5);

    expect(stats.successRate).toBe(33.3);
  });

  it("returns a safe all-zero result (not a throw) when either count query fails", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: [
          { data: null, error: { message: "db down" }, count: null },
          { data: null, error: null, count: 0 },
        ],
      },
    });
    holder.client = client;

    await expect(getExecutionStatsForWorkflow(5)).resolves.toEqual({
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      successRate: null,
    });
  });
});

describe("latestExecutionByOrderId", () => {
  it("keeps only the first execution seen per order_id", () => {
    const executions = [
      { order_id: 1, status: "failed" as const },
      { order_id: 2, status: "success" as const },
      { order_id: 1, status: "success" as const }, // older, since input is newest-first
    ];

    const result = latestExecutionByOrderId(executions);

    expect(result.get(1)).toEqual({ order_id: 1, status: "failed" });
    expect(result.get(2)).toEqual({ order_id: 2, status: "success" });
    expect(result.size).toBe(2);
  });

  it("returns an empty map for an empty input", () => {
    expect(latestExecutionByOrderId([]).size).toBe(0);
  });
});

describe("uniqueByWorkflowAndOrder", () => {
  it("collapses several rows for the same (workflow_id, order_id) pair into one, keeping the last one seen", () => {
    const executions = [
      { workflow_id: 1, order_id: 100, step_order: 1 },
      { workflow_id: 1, order_id: 100, step_order: 2 },
      { workflow_id: 2, order_id: 100, step_order: 1 },
    ];

    const result = uniqueByWorkflowAndOrder(executions);

    expect(result).toEqual([
      { workflow_id: 1, order_id: 100, step_order: 2 },
      { workflow_id: 2, order_id: 100, step_order: 1 },
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(uniqueByWorkflowAndOrder([])).toEqual([]);
  });
});
