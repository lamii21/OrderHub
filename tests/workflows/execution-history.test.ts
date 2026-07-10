import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { recordWorkflowExecution } from "@/lib/workflows/execution-history";

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
