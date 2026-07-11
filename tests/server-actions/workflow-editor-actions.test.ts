import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";
import { __resetRateLimitState } from "@/lib/rate-limit";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
const { runWorkflow } = vi.hoisted(() => ({ runWorkflow: vi.fn() }));
const headersMock = vi.hoisted(() => ({ ip: "203.0.113.5" }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "x-forwarded-for" ? headersMock.ip : null),
  })),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));
vi.mock("@/lib/workflows/engine", () => ({ runWorkflow }));

// Uses the REAL automation module registry (not mocked) — activateWorkflow's
// and addWorkflowStep's module-existence/validateConfig checks are only
// meaningful tested against the real registry, same modules a merchant
// would actually pick from in the Builder's dropdown.
import {
  updateWorkflowDetails,
  activateWorkflow,
  deactivateWorkflow,
  addWorkflowStep,
  updateWorkflowStep,
  removeWorkflowStep,
  moveWorkflowStepUp,
  moveWorkflowStepDown,
  runWorkflowNow,
} from "@/app/shops/[id]/workflows/[workflowId]/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  runWorkflow.mockReset();
  __resetRateLimitState();
  headersMock.ip = "203.0.113.5";
});

describe("id validation shared across every action in this file", () => {
  it("moveWorkflowStepUp redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      moveWorkflowStepUp(formData({ shop_id: "-1", workflow_id: "5", step_id: "20" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("moveWorkflowStepUp redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      moveWorkflowStepUp(formData({ shop_id: "1", workflow_id: "abc", step_id: "20" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
  });

  it("removeWorkflowStep redirects to the editor on an invalid step_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      removeWorkflowStep(formData({ shop_id: "1", workflow_id: "5", step_id: "0" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows/5?error=" + encodeURIComponent("Invalid step."));
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("activateWorkflow", () => {
  const base = { shop_id: "1", workflow_id: "5" };

  it("rejects activation when the workflow has no steps", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: { id: 5, name: "A", trigger_event: "order.created", activated_at: null, workflow_steps: [] },
          error: null,
        },
      },
    });
    holder.client = client;

    await expect(activateWorkflow(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*at%20least%20one%20step/
    );
  });

  it("rejects activation when a step references an unregistered module", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: {
            id: 5,
            name: "A",
            trigger_event: "order.created",
            activated_at: null,
            workflow_steps: [{ id: 1, workflow_id: 5, step_order: 1, module_name: "carrier-pigeon", config: {} }],
          },
          error: null,
        },
      },
    });
    holder.client = client;

    await expect(activateWorkflow(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*carrier-pigeon/
    );
  });

  // Every applicable reason is listed together in one redirect, not just
  // the first one found (UI specification, Errors section: "plusieurs
  // raisons possibles à la fois, listées à puces").
  it("lists every activation problem at once, not just the first one found", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: {
            id: 5,
            name: "  ",
            trigger_event: "order.created",
            activated_at: null,
            workflow_steps: [
              { id: 1, workflow_id: 5, step_order: 1, module_name: "carrier-pigeon", config: {} },
              { id: 2, workflow_id: 5, step_order: 2, module_name: "carrier-owl", config: {} },
            ],
          },
          error: null,
        },
      },
    });
    holder.client = client;

    await expect(activateWorkflow(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=Cannot%20activate.*name%20is%20required.*carrier-pigeon.*carrier-owl/
    );
  });

  it("activates and stamps activated_at the first time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { client, builders } = createMockSupabase({
      responses: {
        workflows: [
          {
            data: {
              id: 5,
              name: "A",
              trigger_event: "order.created",
              activated_at: null,
              workflow_steps: [{ id: 1, workflow_id: 5, step_order: 1, module_name: "archive", config: {} }],
            },
            error: null,
          },
          { data: null, error: null }, // the update itself
        ],
      },
    });
    holder.client = client;

    await expect(activateWorkflow(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5?activated=1"
    );

    expect(builders.workflows[1].update).toHaveBeenCalledWith({
      is_active: true,
      activated_at: "2026-01-01T00:00:00.000Z",
    });

    vi.useRealTimers();
  });

  it("does not re-stamp activated_at on a workflow that was already activated before", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflows: [
          {
            data: {
              id: 5,
              name: "A",
              trigger_event: "order.created",
              activated_at: "2025-06-01T00:00:00.000Z",
              workflow_steps: [{ id: 1, workflow_id: 5, step_order: 1, module_name: "archive", config: {} }],
            },
            error: null,
          },
          { data: null, error: null },
        ],
      },
    });
    holder.client = client;

    await expect(activateWorkflow(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5?activated=1"
    );

    expect(builders.workflows[1].update).toHaveBeenCalledWith({ is_active: true });
  });
});

describe("deactivateWorkflow", () => {
  it("always succeeds with no validation", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflows: { data: null, error: null } },
    });
    holder.client = client;

    await expect(
      deactivateWorkflow(formData({ shop_id: "1", workflow_id: "5" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows/5?deactivated=1");

    expect(builders.workflows[0].update).toHaveBeenCalledWith({ is_active: false });
  });
});

describe("addWorkflowStep", () => {
  const base = { shop_id: "1", workflow_id: "5" };

  // Validation failures redirect back to this step's own Properties Panel
  // (.../steps/new?module=...), not the main editor — the error renders
  // localized above the config field there (UI specification §6), not as
  // a page-top banner.
  it("rejects invalid JSON config", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      addWorkflowStep(formData({ ...base, module_name: "archive", config: "{not json" }))
    ).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\/steps\/new\?module=archive&error=.*valid%20JSON/
    );
  });

  it("rejects a config that fails the module's own validateConfig, without ever inserting", async () => {
    const { client } = createMockSupabase({ responses: { workflow_steps: [] } });
    holder.client = client;

    await expect(
      addWorkflowStep(formData({ ...base, module_name: "tag-order", config: "{}" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\/steps\/new\?module=tag-order&error=/);
    expect(client.from).not.toHaveBeenCalledWith("workflow_steps");
  });

  it("rejects a config larger than the size cap, without ever inserting", async () => {
    const { client } = createMockSupabase();
    holder.client = client;
    const hugeConfig = JSON.stringify({ blob: "x".repeat(10_001) });

    await expect(
      addWorkflowStep(formData({ ...base, module_name: "archive", config: hugeConfig }))
    ).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\/steps\/new\?module=archive&error=.*too%20large/
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("does NOT reject a config for a module_name that isn't registered (existence is checked at activation, not here)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [{ data: null, error: null }, { data: null, error: null }],
      },
    });
    holder.client = client;

    await expect(
      addWorkflowStep(formData({ ...base, module_name: "carrier-pigeon", config: "{}" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows/5");

    expect(builders.workflow_steps[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({ module_name: "carrier-pigeon" })
    );
  });

  it("appends the new step at max(step_order) + 1", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [{ data: { step_order: 3 }, error: null }, { data: null, error: null }],
      },
    });
    holder.client = client;

    await expect(
      addWorkflowStep(formData({ ...base, module_name: "archive", config: "{}" }))
    ).rejects.toThrow();

    expect(builders.workflow_steps[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({ step_order: 4, workflow_id: 5 })
    );
  });

  it("starts at step_order 1 for the first step in a workflow", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [{ data: null, error: null }, { data: null, error: null }],
      },
    });
    holder.client = client;

    await expect(
      addWorkflowStep(formData({ ...base, module_name: "archive", config: "{}" }))
    ).rejects.toThrow();

    expect(builders.workflow_steps[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({ step_order: 1 })
    );
  });
});

describe("updateWorkflowStep", () => {
  const base = { shop_id: "1", workflow_id: "5", step_id: "20" };

  // Validation failures redirect back to this step's own Properties Panel
  // (.../steps/[stepId]/edit), not the main editor — same reasoning as
  // addWorkflowStep above.
  it("rejects invalid JSON config without writing", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowStep(formData({ ...base, module_name: "archive", config: "{not json" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\/steps\/20\/edit\?error=.*valid%20JSON/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects a config larger than the size cap without writing", async () => {
    const { client } = createMockSupabase();
    holder.client = client;
    const hugeConfig = JSON.stringify({ blob: "x".repeat(10_001) });

    await expect(
      updateWorkflowStep(formData({ ...base, module_name: "archive", config: hugeConfig }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\/steps\/20\/edit\?error=.*too%20large/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects a config that fails the module's own validateConfig", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowStep(formData({ ...base, module_name: "tag-order", config: "{}" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\/steps\/20\/edit\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("updates module_name and config, and reports the database error if the write fails", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflow_steps: { data: null, error: { message: "constraint violation" } } },
    });
    holder.client = client;

    await expect(
      updateWorkflowStep(formData({ ...base, module_name: "archive", config: '{"a":1}' }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\?error=.*Could%20not%20update/);

    expect(builders.workflow_steps[0].update).toHaveBeenCalledWith({
      module_name: "archive",
      config: { a: 1 },
    });
  });

  it("redirects back to the editor on success", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_steps: { data: null, error: null } },
    });
    holder.client = client;

    await expect(
      updateWorkflowStep(formData({ ...base, module_name: "archive", config: "{}" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows/5");
  });
});

describe("removeWorkflowStep", () => {
  const base = { shop_id: "1", workflow_id: "5", step_id: "20" };

  it("deletes the step, renumbers the remaining ones, and redirects", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: null, error: null }, // the delete
          {
            data: [
              { id: 1, step_order: 1 },
              { id: 3, step_order: 3 }, // gap left by the deleted step 2
            ],
            error: null,
          },
          { data: null, error: null }, // renumber step 3 -> 2
        ],
      },
    });
    holder.client = client;

    await expect(removeWorkflowStep(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5"
    );

    expect(builders.workflow_steps[0].delete).toHaveBeenCalled();
    expect(builders.workflow_steps[0].eq).toHaveBeenCalledWith("id", 20);
    expect(builders.workflow_steps[2].update).toHaveBeenCalledWith({ step_order: 2 });
    expect(builders.workflow_steps[2].eq).toHaveBeenCalledWith("id", 3);
  });

  it("reports the database error and skips renumbering when the delete fails", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_steps: { data: null, error: { message: "fk violation" } },
      },
    });
    holder.client = client;

    await expect(removeWorkflowStep(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*Could%20not%20remove/
    );
  });
});

describe("moveWorkflowStepUp", () => {
  const base = { shop_id: "1", workflow_id: "5", step_id: "20" };

  it("does nothing when the step is already first (no neighbor above)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: { id: 20, step_order: 1 }, error: null }, // the step itself
          { data: null, error: null }, // no neighbor above
        ],
      },
    });
    holder.client = client;

    await expect(moveWorkflowStepUp(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5"
    );

    // Only the 2 reads happened — no update (no 3-step swap).
    expect(builders.workflow_steps.every((b) => (b.update as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(
      true
    );
  });

  it("swaps step_order with the neighbor above via the 3-update sentinel technique", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: { id: 20, step_order: 2 }, error: null }, // the step itself
          { data: { id: 19, step_order: 1 }, error: null }, // neighbor above
          { data: [{ id: 20 }], error: null }, // update 1: current -> 0 (row affected)
          { data: [{ id: 19 }], error: null }, // update 2: neighbor -> current's old order (row affected)
          { data: null, error: null }, // update 3: current -> neighbor's old order
        ],
      },
    });
    holder.client = client;

    await expect(moveWorkflowStepUp(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5"
    );

    const updateCalls = builders.workflow_steps
      .flatMap((b) => (b.update as ReturnType<typeof vi.fn>).mock.calls)
      .map((c) => c[0]);
    expect(updateCalls).toEqual([{ step_order: 0 }, { step_order: 2 }, { step_order: 1 }]);
  });

  // Regression test for the Optimistic Concurrency fix: if another request
  // (a second tab, a double-submitted form) already moved the "current"
  // step between the read and the write, the guarded .eq("step_order", …)
  // predicate matches zero rows. The old code had no way to detect this
  // and would silently report success while leaving the ordering
  // undefined; the fix aborts and tells the user to retry.
  it("redirects with an error, and performs no further writes, when the current step lost the race", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: { id: 20, step_order: 2 }, error: null },
          { data: { id: 19, step_order: 1 }, error: null },
          { data: [], error: null }, // park update matched 0 rows: someone else moved it first
        ],
      },
    });
    holder.client = client;

    await expect(moveWorkflowStepUp(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*try%20again/
    );

    // Exactly one write was attempted (the failed park) — no neighbor
    // update, no finalize, no silent partial swap.
    const updateCalls = builders.workflow_steps.flatMap(
      (b) => (b.update as ReturnType<typeof vi.fn>).mock.calls
    );
    expect(updateCalls).toHaveLength(1);
  });

  it("rolls the current step back and redirects with an error when the neighbor lost the race", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: { id: 20, step_order: 2 }, error: null },
          { data: { id: 19, step_order: 1 }, error: null },
          { data: [{ id: 20 }], error: null }, // park succeeds
          { data: [], error: null }, // neighbor update matches 0 rows: it moved first
          { data: null, error: null }, // rollback: current -> back to step_order 2
        ],
      },
    });
    holder.client = client;

    await expect(moveWorkflowStepUp(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*try%20again/
    );

    const updateCalls = builders.workflow_steps
      .flatMap((b) => (b.update as ReturnType<typeof vi.fn>).mock.calls)
      .map((c) => c[0]);
    // park to 0, failed neighbor attempt, rollback current back to 2 — no
    // 3rd "finalize" write ever happens.
    expect(updateCalls).toEqual([{ step_order: 0 }, { step_order: 2 }, { step_order: 2 }]);
  });
});

describe("moveWorkflowStepDown", () => {
  const base = { shop_id: "1", workflow_id: "5", step_id: "20" };

  it("does nothing when the step is already last (no neighbor below)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: { id: 20, step_order: 3 }, error: null },
          { data: null, error: null }, // no neighbor below
        ],
      },
    });
    holder.client = client;

    await expect(moveWorkflowStepDown(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5"
    );

    expect(builders.workflow_steps.every((b) => (b.update as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(
      true
    );
  });

  it("swaps step_order with the neighbor below via the 3-update sentinel technique", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: { id: 20, step_order: 1 }, error: null },
          { data: { id: 21, step_order: 2 }, error: null }, // neighbor below
          { data: [{ id: 20 }], error: null },
          { data: [{ id: 21 }], error: null },
          { data: null, error: null },
        ],
      },
    });
    holder.client = client;

    await expect(moveWorkflowStepDown(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5"
    );

    const updateCalls = builders.workflow_steps
      .flatMap((b) => (b.update as ReturnType<typeof vi.fn>).mock.calls)
      .map((c) => c[0]);
    expect(updateCalls).toEqual([{ step_order: 0 }, { step_order: 1 }, { step_order: 2 }]);
  });
});

describe("runWorkflowNow", () => {
  const base = { shop_id: "1", workflow_id: "5" };

  it("redirects with an error when the shop has no orders to test against", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: { id: 5, name: "A", trigger_event: "order.created", activated_at: null, workflow_steps: [] },
          error: null,
        },
        orders: { data: null, error: null },
      },
    });
    holder.client = client;

    await expect(runWorkflowNow(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*no%20orders/
    );
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("runs the workflow against the shop's most recent order and redirects with tested=1", async () => {
    const workflowRow = {
      id: 5,
      name: "A",
      trigger_event: "order.created",
      activated_at: null,
      workflow_steps: [{ id: 1, workflow_id: 5, step_order: 1, module_name: "archive", config: {} }],
    };
    const latestOrder = { id: 99, shop_id: 1, customer_name: "Amina" };
    const { client } = createMockSupabase({
      responses: {
        workflows: { data: workflowRow, error: null },
        orders: { data: latestOrder, error: null },
      },
    });
    holder.client = client;

    await expect(runWorkflowNow(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5?tested=1"
    );

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5 }),
      expect.objectContaining({ id: 99 })
    );
  });

  it("redirects with an error once the rate limit is exceeded, without loading the workflow", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: { id: 5, name: "A", trigger_event: "order.created", activated_at: null, workflow_steps: [] },
          error: null,
        },
        orders: { data: { id: 99, shop_id: 1 }, error: null },
      },
    });
    holder.client = client;

    for (let i = 0; i < 10; i++) {
      await expect(runWorkflowNow(formData(base))).rejects.toThrow();
    }

    client.from.mockClear();
    await expect(runWorkflowNow(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*Too%20many%20requests/
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("tracks separate callers independently for the rate limit", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: { id: 5, name: "A", trigger_event: "order.created", activated_at: null, workflow_steps: [] },
          error: null,
        },
        orders: { data: { id: 99, shop_id: 1 }, error: null },
      },
    });
    holder.client = client;

    for (let i = 0; i < 10; i++) {
      await expect(runWorkflowNow(formData(base))).rejects.toThrow();
    }

    headersMock.ip = "198.51.100.9";
    await expect(runWorkflowNow(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5?tested=1"
    );
  });

  it("redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      runWorkflowNow(formData({ shop_id: "-1", workflow_id: "5" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(runWorkflowNow(formData({ shop_id: "1", workflow_id: "abc" }))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow.")
    );
  });

  it("redirects with an error when the workflow fails to load", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(runWorkflowNow(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*Could%20not%20load%20the%20workflow/
    );
    expect(runWorkflow).not.toHaveBeenCalled();
  });
});

describe("updateWorkflowDetails", () => {
  const base = { shop_id: "1", workflow_id: "5", name: "Welcome flow", trigger_event: "order.created" };

  it("redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowDetails(formData({ ...base, shop_id: "-1" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowDetails(formData({ ...base, workflow_id: "abc" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
  });

  it("redirects with an error on an empty name, without writing", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(updateWorkflowDetails(formData({ ...base, name: "  " }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*name%20is%20required/
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("redirects with an error on an invalid trigger event, without writing", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowDetails(formData({ ...base, trigger_event: "order.paid" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\?error=.*Invalid%20trigger%20event/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("saves the new name/trigger and redirects back to the editor", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflows: { data: null, error: null } },
    });
    holder.client = client;

    await expect(updateWorkflowDetails(formData(base))).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5"
    );

    expect(builders.workflows[0].update).toHaveBeenCalledWith({
      name: "Welcome flow",
      trigger_event: "order.created",
    });
    expect(builders.workflows[0].eq).toHaveBeenCalledWith("id", 5);
  });

  it("redirects with an error when the update fails", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(updateWorkflowDetails(formData(base))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/workflows\/5\?error=.*Could%20not%20update%20the%20workflow/
    );
  });
});

describe("id validation not otherwise covered above", () => {
  it("deactivateWorkflow redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      deactivateWorkflow(formData({ shop_id: "-1", workflow_id: "5" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("deactivateWorkflow redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      deactivateWorkflow(formData({ shop_id: "1", workflow_id: "abc" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
  });

  it("activateWorkflow redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      activateWorkflow(formData({ shop_id: "-1", workflow_id: "5" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("activateWorkflow redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      activateWorkflow(formData({ shop_id: "1", workflow_id: "abc" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
  });

  it("activateWorkflow redirects with an error when the workflow fails to load", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(
      activateWorkflow(formData({ shop_id: "1", workflow_id: "5" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\?error=.*Could%20not%20load%20the%20workflow/);
  });

  it("addWorkflowStep redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      addWorkflowStep(formData({ shop_id: "-1", workflow_id: "5", module_name: "archive", config: "{}" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("addWorkflowStep redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      addWorkflowStep(formData({ shop_id: "1", workflow_id: "abc", module_name: "archive", config: "{}" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
  });

  it("addWorkflowStep redirects with an error when loading the existing steps fails", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_steps: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(
      addWorkflowStep(formData({ shop_id: "1", workflow_id: "5", module_name: "archive", config: "{}" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\?error=.*Could%20not%20add%20the%20step/);
  });

  it("updateWorkflowStep redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowStep(
        formData({ shop_id: "-1", workflow_id: "5", step_id: "20", module_name: "archive", config: "{}" })
      )
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("updateWorkflowStep redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowStep(
        formData({ shop_id: "1", workflow_id: "abc", step_id: "20", module_name: "archive", config: "{}" })
      )
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
  });

  it("updateWorkflowStep redirects to the editor on an invalid step_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowStep(
        formData({ shop_id: "1", workflow_id: "5", step_id: "0", module_name: "archive", config: "{}" })
      )
    ).rejects.toThrow("REDIRECT:/shops/1/workflows/5?error=" + encodeURIComponent("Invalid step."));
  });

  it("updateWorkflowStep redirects to its own edit page when no module is chosen", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      updateWorkflowStep(formData({ shop_id: "1", workflow_id: "5", step_id: "20", config: "{}" }))
    ).rejects.toThrow(
      "REDIRECT:/shops/1/workflows/5/steps/20/edit?error=" +
        encodeURIComponent("Choose a module for this step.")
    );
  });

  it("removeWorkflowStep redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      removeWorkflowStep(formData({ shop_id: "-1", workflow_id: "5", step_id: "20" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("removeWorkflowStep redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      removeWorkflowStep(formData({ shop_id: "1", workflow_id: "abc", step_id: "20" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
  });

  it("removeWorkflowStep redirects with an error when the renumbering read fails, after the delete itself already succeeded", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: null, error: null }, // the delete succeeds
          { data: null, error: { message: "db down" } }, // renumberSteps' own read fails
        ],
      },
    });
    holder.client = client;

    // renumberSteps() logs and returns without redirecting on its own
    // failure — removeWorkflowStep() still redirects to the editor
    // normally afterward, since the step itself was already removed.
    await expect(
      removeWorkflowStep(formData({ shop_id: "1", workflow_id: "5", step_id: "20" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows/5");
    expect(builders.workflow_steps[1].select).toHaveBeenCalledWith("id, step_order");
  });

  it("moveWorkflowStepUp redirects to the shop list on an invalid shop_id, touching no table (also covered above, kept for symmetry)", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      moveWorkflowStepUp(formData({ shop_id: "-1", workflow_id: "5", step_id: "20" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("moveWorkflowStepUp redirects with an error (never throws unhandled) when the park update itself errors, not just when it affects 0 rows", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_steps: [
          { data: { id: 20, step_order: 2 }, error: null },
          { data: { id: 19, step_order: 1 }, error: null },
          { data: null, error: { message: "db down" } }, // park update errors outright
        ],
      },
    });
    holder.client = client;

    await expect(
      moveWorkflowStepUp(formData({ shop_id: "1", workflow_id: "5", step_id: "20" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\?error=.*try%20again/);

    const updateCalls = builders.workflow_steps.flatMap(
      (b) => (b.update as ReturnType<typeof vi.fn>).mock.calls
    );
    expect(updateCalls).toHaveLength(1);
  });

  it("moveWorkflowStepDown redirects to the shop list on an invalid shop_id, touching no table", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      moveWorkflowStepDown(formData({ shop_id: "-1", workflow_id: "5", step_id: "20" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("moveWorkflowStepDown redirects to the workflow list on an invalid workflow_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      moveWorkflowStepDown(formData({ shop_id: "1", workflow_id: "abc", step_id: "20" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
  });

  it("moveWorkflowStepDown redirects to the editor on an invalid step_id", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      moveWorkflowStepDown(formData({ shop_id: "1", workflow_id: "5", step_id: "0" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows/5?error=" + encodeURIComponent("Invalid step."));
  });

  it("moveWorkflowStepDown redirects with an error when the step itself fails to load", async () => {
    const { client } = createMockSupabase({
      responses: { workflow_steps: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(
      moveWorkflowStepDown(formData({ shop_id: "1", workflow_id: "5", step_id: "20" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/5\?error=.*Could%20not%20move%20the%20step/);
  });
});
