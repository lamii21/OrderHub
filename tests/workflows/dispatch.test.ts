import { describe, it, expect, vi, beforeEach } from "vitest";

const { resolveWorkflows, runWorkflow } = vi.hoisted(() => ({
  resolveWorkflows: vi.fn(),
  runWorkflow: vi.fn(),
}));

vi.mock("@/lib/workflows/manager", () => ({ resolveWorkflows }));
vi.mock("@/lib/workflows/engine", () => ({ runWorkflow }));

import { handleEvent } from "@/lib/workflows/dispatch";
import type { Order } from "@/types/order";
import type { WorkflowWithSteps } from "@/types/workflow";

const order = { id: 1, shop_id: 5 } as Order;

function fakeWorkflow(id: number): WorkflowWithSteps {
  return {
    id,
    shop_id: 5,
    name: `Workflow ${id}`,
    trigger_event: "order.created",
    is_active: true,
    activated_at: null,
    created_at: "2026-01-01T00:00:00Z",
    steps: [],
  };
}

beforeEach(() => {
  resolveWorkflows.mockReset();
  runWorkflow.mockReset();
});

describe("handleEvent", () => {
  it("resolves workflows for the given (shopId, eventType) and runs each one", async () => {
    resolveWorkflows.mockResolvedValue([fakeWorkflow(1), fakeWorkflow(2)]);

    await handleEvent(5, "order.created", order);

    expect(resolveWorkflows).toHaveBeenCalledWith(5, "order.created");
    expect(runWorkflow).toHaveBeenCalledTimes(2);
    expect(runWorkflow).toHaveBeenNthCalledWith(1, fakeWorkflow(1), order);
    expect(runWorkflow).toHaveBeenNthCalledWith(2, fakeWorkflow(2), order);
  });

  it("never calls runWorkflow when no workflow matches", async () => {
    resolveWorkflows.mockResolvedValue([]);

    await handleEvent(5, "order.cancelled", order);

    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("runs matched workflows sequentially, not in parallel", async () => {
    const callOrder: string[] = [];
    resolveWorkflows.mockResolvedValue([fakeWorkflow(1), fakeWorkflow(2)]);
    runWorkflow.mockImplementation(async (workflow: WorkflowWithSteps) => {
      callOrder.push(`start-${workflow.id}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      callOrder.push(`end-${workflow.id}`);
    });

    await handleEvent(5, "order.created", order);

    expect(callOrder).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("defaults to depth 0, which is well under the cascade guard", async () => {
    resolveWorkflows.mockResolvedValue([fakeWorkflow(1)]);

    await handleEvent(5, "order.created", order);

    expect(resolveWorkflows).toHaveBeenCalled();
  });

  // Regression test for the cascade-depth guard: nothing in the codebase
  // recurses into handleEvent() today, but this proves the guard itself
  // actually stops a hypothetical future recursive caller rather than just
  // existing as an unused parameter.
  it("bails out without resolving or running anything once MAX_DISPATCH_DEPTH is reached", async () => {
    await handleEvent(5, "order.created", order, 3);

    expect(resolveWorkflows).not.toHaveBeenCalled();
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("still runs normally one level below the depth cap", async () => {
    resolveWorkflows.mockResolvedValue([fakeWorkflow(1)]);

    await handleEvent(5, "order.created", order, 2);

    expect(runWorkflow).toHaveBeenCalledTimes(1);
  });
});
