import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAutomationModule, recordWorkflowExecution, isCircuitOpen, persistWorkflowWait } = vi.hoisted(() => ({
  getAutomationModule: vi.fn(),
  recordWorkflowExecution: vi.fn(),
  isCircuitOpen: vi.fn(),
  persistWorkflowWait: vi.fn(),
}));

vi.mock("@/lib/automation-modules", () => ({ getAutomationModule }));
vi.mock("@/lib/workflows/execution-history", () => ({ recordWorkflowExecution }));
vi.mock("@/lib/workflows/circuit-breaker", () => ({
  isCircuitOpen,
  CONSECUTIVE_FAILURE_THRESHOLD: 3,
}));
vi.mock("@/lib/workflows/resume", () => ({ persistWorkflowWait }));

import { runWorkflow, resumeWorkflow } from "@/lib/workflows/engine";
import type { WorkflowWithSteps } from "@/types/workflow";
import type { Order } from "@/types/order";

const order = { id: 100, shop_id: 1 } as Order;

function workflowWithSteps(steps: WorkflowWithSteps["steps"]): WorkflowWithSteps {
  return {
    id: 1,
    shop_id: 1,
    name: "Test workflow",
    trigger_event: "order.created",
    is_active: true,
    activated_at: null,
    created_at: "2026-01-01T00:00:00Z",
    steps,
  };
}

beforeEach(() => {
  getAutomationModule.mockReset();
  recordWorkflowExecution.mockReset();
  isCircuitOpen.mockReset().mockResolvedValue(false);
  persistWorkflowWait.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runWorkflow", () => {
  it("records a failed step and continues when a module isn't registered", async () => {
    getAutomationModule.mockReturnValue(null);
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "ghost-module", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stepOrder: 1,
        moduleName: "ghost-module",
        status: "failed",
        message: 'No automation module registered for "ghost-module".',
      })
    );
  });

  it("skips a step (recorded as success) when shouldRun returns false, without calling run()", async () => {
    const run = vi.fn();
    getAutomationModule.mockReturnValue({ shouldRun: vi.fn().mockResolvedValue(false), run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(run).not.toHaveBeenCalled();
    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", message: "Skipped (shouldRun returned false)." })
    );
  });

  it("runs a step with no shouldRun as always-running", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("passes the step's own config to run()", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "whatsapp", config: { template: "Hi {{customer_name}}" } },
    ]);

    await runWorkflow(workflow, order);

    expect(run).toHaveBeenCalledWith(order, { template: "Hi {{customer_name}}" }, {});
  });

  it("folds a successful step's data into the context passed to later steps", async () => {
    const aiAgentRun = vi.fn().mockResolvedValue({ success: true, data: { category: "vip" } });
    const tagOrderRun = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockImplementation((name: string) =>
      name === "ai-agent" ? { run: aiAgentRun } : { run: tagOrderRun }
    );
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "ai-agent", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "tag-order", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(tagOrderRun).toHaveBeenCalledWith(order, {}, { "ai-agent": { category: "vip" } });
  });

  it("records a failed ModuleResult without throwing, and still runs the next step", async () => {
    const firstRun = vi.fn().mockResolvedValue({ success: false, message: "No credentials." });
    const secondRun = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockImplementation((name: string) =>
      name === "whatsapp" ? { run: firstRun } : { run: secondRun }
    );
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "whatsapp", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(secondRun).toHaveBeenCalledTimes(1);
    expect(recordWorkflowExecution).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: "failed", message: "No credentials." })
    );
    expect(recordWorkflowExecution).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: "success" })
    );
  });

  it("isolates a step that throws: catches it, records a safe fixed message (never the raw error), and continues", async () => {
    const throwingRun = vi.fn().mockRejectedValue(new Error("stack trace with secrets"));
    const secondRun = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockImplementation((name: string) =>
      name === "webhook" ? { run: throwingRun } : { run: secondRun }
    );
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "webhook", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(secondRun).toHaveBeenCalledTimes(1);
    const failedCall = recordWorkflowExecution.mock.calls[0][0];
    expect(failedCall.status).toBe("failed");
    expect(failedCall.message).toBe('Module "webhook" failed to run.');
    expect(failedCall.message).not.toContain("secrets");
  });

  it("runs steps in order and records one execution per step", async () => {
    const order1 = vi.fn();
    const run = vi.fn(async (..._args) => {
      order1(Date.now());
      return { success: true };
    });
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "notes", config: {} },
      { id: 3, workflow_id: 1, step_order: 3, module_name: "tag-order", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(recordWorkflowExecution).toHaveBeenCalledTimes(3);
    expect(recordWorkflowExecution.mock.calls.map((c) => c[0].stepOrder)).toEqual([1, 2, 3]);
  });

  it("skips a step whose circuit is open, without calling the module, and records why", async () => {
    const run = vi.fn();
    getAutomationModule.mockReturnValue({ run });
    isCircuitOpen.mockResolvedValue(true);
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "whatsapp", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(isCircuitOpen).toHaveBeenCalledWith(1, 1, "whatsapp");
    expect(run).not.toHaveBeenCalled();
    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", message: expect.stringContaining("Circuit open") })
    );
  });

  it("still runs a step normally when its circuit is closed", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockReturnValue({ run });
    isCircuitOpen.mockResolvedValue(false);
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(run).toHaveBeenCalledTimes(1);
  });

  // Regression test for the cross-shop integrity guard: nothing in the
  // codebase currently pairs a workflow with an order from a different
  // shop, but workflow_executions' RLS policy trusts workflow_id's
  // ownership chain only, never order_id's — this is the app-level
  // backstop for that gap.
  it("refuses to run when the order's shop_id doesn't match the workflow's shop_id", async () => {
    const run = vi.fn();
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
    ]);
    const mismatchedOrder = { id: 999, shop_id: 42 } as Order;

    await runWorkflow(workflow, mismatchedOrder);

    expect(run).not.toHaveBeenCalled();
    expect(recordWorkflowExecution).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("shop mismatch"));
  });

  it("still runs normally when the order has no shop_id at all (legacy/edge-case data)", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
    ]);
    const orderWithNoShop = { id: 999, shop_id: null } as Order;

    await runWorkflow(workflow, orderWithNoShop);

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("runWorkflow — outcome vocabulary (stop / waiting / retry)", () => {
  it('"stop" halts the rest of the workflow and records the halting step as a success', async () => {
    const stoppingRun = vi.fn().mockResolvedValue({
      success: false,
      outcome: "stop",
      message: "Condition not met",
    });
    const laterRun = vi.fn();
    getAutomationModule.mockImplementation((name: string) =>
      name === "condition" ? { run: stoppingRun } : { run: laterRun }
    );
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "condition", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(laterRun).not.toHaveBeenCalled();
    expect(recordWorkflowExecution).toHaveBeenCalledTimes(1);
    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stepOrder: 1,
        status: "success",
        message: expect.stringContaining("Workflow stopped"),
      })
    );
  });

  it('"stop" is recorded as a success even when the module also sets success: true', async () => {
    const stoppingRun = vi.fn().mockResolvedValue({ success: true, outcome: "stop" });
    getAutomationModule.mockReturnValue({ run: stoppingRun });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "condition", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" })
    );
  });

  it('"waiting" halts the rest of the workflow, persists a wait to resume at the next step, and records the pausing step as a success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const waitingRun = vi.fn().mockResolvedValue({
      success: false,
      outcome: "waiting",
      message: "Waiting 30m",
      data: { duration: "30m", durationMs: 30 * 60 * 1000 },
    });
    const laterRun = vi.fn();
    getAutomationModule.mockImplementation((name: string) =>
      name === "delay" ? { run: waitingRun } : { run: laterRun }
    );
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "delay", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(laterRun).not.toHaveBeenCalled();
    expect(persistWorkflowWait).toHaveBeenCalledWith({
      workflowId: 1,
      orderId: 100,
      resumeStepId: 2,
      context: { delay: { duration: "30m", durationMs: 30 * 60 * 1000 } },
      resumeAt: new Date("2026-01-01T00:30:00.000Z"),
    });
    expect(recordWorkflowExecution).toHaveBeenCalledTimes(1);
    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stepOrder: 1,
        status: "success",
        message: expect.stringContaining("Resumes automatically at step 2"),
      })
    );

    vi.useRealTimers();
  });

  it('"waiting" on the last step does not persist a wait (nothing left to resume into)', async () => {
    const waitingRun = vi.fn().mockResolvedValue({
      success: false,
      outcome: "waiting",
      message: "Waiting 30m",
      data: { durationMs: 1000 },
    });
    getAutomationModule.mockReturnValue({ run: waitingRun });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "delay", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(persistWorkflowWait).not.toHaveBeenCalled();
    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        message: expect.stringContaining("nothing to resume"),
      })
    );
  });

  it('"waiting" with no durationMs in data resumes as soon as the next cron tick picks it up (resumeAt defaults to now)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const waitingRun = vi.fn().mockResolvedValue({ success: false, outcome: "waiting" });
    getAutomationModule.mockReturnValue({ run: waitingRun });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "delay", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(persistWorkflowWait).toHaveBeenCalledWith(
      expect.objectContaining({ resumeAt: new Date("2026-01-01T00:00:00.000Z") })
    );

    vi.useRealTimers();
  });

  it('"retry" is recorded as failed and does NOT halt the workflow — the next step still runs', async () => {
    const retryingRun = vi.fn().mockResolvedValue({
      success: false,
      outcome: "retry",
      message: "Rate limited",
    });
    const laterRun = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockImplementation((name: string) =>
      name === "whatsapp" ? { run: retryingRun } : { run: laterRun }
    );
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "whatsapp", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(laterRun).toHaveBeenCalledTimes(1);
    expect(recordWorkflowExecution).toHaveBeenCalledTimes(2);
    expect(recordWorkflowExecution).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stepOrder: 1,
        status: "failed",
        message: expect.stringContaining("Retry requested"),
      })
    );
    expect(recordWorkflowExecution).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ stepOrder: 2, status: "success" })
    );
  });

  it("a module with no outcome field behaves exactly as before (plain success/failed on the `success` boolean)", async () => {
    const run = vi.fn().mockResolvedValue({ success: false, message: "No credentials." });
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "whatsapp", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", message: "No credentials." })
    );
  });

  it('an explicit outcome: "success" behaves exactly like omitting outcome', async () => {
    const run = vi.fn().mockResolvedValue({ success: true, outcome: "success", message: "Done" });
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
    ]);

    await runWorkflow(workflow, order);

    expect(recordWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", message: "Done" })
    );
  });

  it('"stop" on the last step still completes normally (no error from halting with nothing left to run)', async () => {
    const stoppingRun = vi.fn().mockResolvedValue({ success: false, outcome: "stop" });
    getAutomationModule.mockReturnValue({ run: stoppingRun });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "condition", config: {} },
    ]);

    await expect(runWorkflow(workflow, order)).resolves.toBeUndefined();
  });
});

describe("resumeWorkflow", () => {
  it("continues from fromStepOrder, never re-running an earlier step", async () => {
    const step1Run = vi.fn().mockResolvedValue({ success: true });
    const step2Run = vi.fn().mockResolvedValue({ success: true });
    const step3Run = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockImplementation((name: string) =>
      name === "delay" ? { run: step1Run } : name === "archive" ? { run: step2Run } : { run: step3Run }
    );
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "delay", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} },
      { id: 3, workflow_id: 1, step_order: 3, module_name: "notes", config: {} },
    ]);

    await resumeWorkflow(workflow, order, 2, {});

    expect(step1Run).not.toHaveBeenCalled();
    expect(step2Run).toHaveBeenCalledTimes(1);
    expect(step3Run).toHaveBeenCalledTimes(1);
    expect(recordWorkflowExecution).toHaveBeenCalledTimes(2);
    expect(recordWorkflowExecution.mock.calls.map((c) => c[0].stepOrder)).toEqual([2, 3]);
  });

  it("passes the restored context through to the resumed steps", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "delay", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "tag-order", config: {} },
    ]);
    const restoredContext = { "ai-agent": { category: "vip" } };

    await resumeWorkflow(workflow, order, 2, restoredContext);

    expect(run).toHaveBeenCalledWith(order, {}, restoredContext);
  });

  it("can itself pause again on a later \"waiting\" step, persisting a new wait", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const waitingRun = vi.fn().mockResolvedValue({
      success: false,
      outcome: "waiting",
      data: { durationMs: 60_000 },
    });
    const laterRun = vi.fn();
    getAutomationModule.mockImplementation((name: string) =>
      name === "delay" ? { run: waitingRun } : { run: laterRun }
    );
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
      { id: 2, workflow_id: 1, step_order: 2, module_name: "delay", config: {} },
      { id: 3, workflow_id: 1, step_order: 3, module_name: "notes", config: {} },
    ]);

    await resumeWorkflow(workflow, order, 2, {});

    expect(laterRun).not.toHaveBeenCalled();
    expect(persistWorkflowWait).toHaveBeenCalledWith(
      expect.objectContaining({ resumeStepId: 3, resumeAt: new Date("2026-01-01T00:01:00.000Z") })
    );

    vi.useRealTimers();
  });

  it("refuses to resume when the order's shop_id doesn't match the workflow's shop_id", async () => {
    const run = vi.fn();
    getAutomationModule.mockReturnValue({ run });
    const workflow = workflowWithSteps([
      { id: 1, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
    ]);
    const mismatchedOrder = { id: 999, shop_id: 42 } as Order;

    await resumeWorkflow(workflow, mismatchedOrder, 1, {});

    expect(run).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("shop mismatch"));
  });
});
