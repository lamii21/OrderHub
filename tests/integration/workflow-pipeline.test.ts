import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

// Only the Supabase boundary is mocked — Workflow Manager, Execution
// Engine, Dispatch, Execution History, the circuit breaker, and the
// Archive/Tag Order modules are all the REAL implementations, wired
// together exactly as they are in production. This is what distinguishes
// this file from tests/workflows/ and tests/modules/, which each test one
// layer in isolation with its neighbors mocked away.
const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { handleEvent } from "@/lib/workflows/dispatch";
import { invalidateWorkflowCache } from "@/lib/workflows/manager";
import type { Order } from "@/types/order";

const order = {
  id: 100,
  shop_id: 7,
  status: "pending",
  tags: ["existing-tag"],
} as Order;

// Every step now does 2 things against workflow_executions before/after
// running: the circuit breaker's own read (real, unmocked here), then
// Execution History's insert. An empty array read keeps the circuit
// closed (fewer than the failure threshold), which is what every test
// below wants by default.
const CIRCUIT_CLOSED = { data: [], error: null };
const INSERT_OK = { data: null, error: null };

function insertedRows(builders: ReturnType<typeof createMockSupabase>["builders"], table: string) {
  return builders[table].flatMap((b) => b.insert.mock.calls).map((call) => call[0]);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  // resolveWorkflows() (lib/workflows/manager.ts) now caches its result
  // per (shopId, eventType) — every test in this file dispatches against
  // the same shop, so without this reset a later test would silently
  // reuse an earlier test's resolved workflow instead of querying its own
  // mocked response.
  invalidateWorkflowCache();
});

describe("end-to-end: order.created -> Workflow Manager -> Execution Engine -> real modules -> Execution History", () => {
  it("runs a 2-step workflow (Archive then Tag Order) and records both executions", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflows: {
          data: [
            {
              id: 1,
              shop_id: 7,
              name: "Archive & tag on creation",
              trigger_event: "order.created",
              is_active: true,
              activated_at: "2026-01-01T00:00:00Z",
              created_at: "2026-01-01T00:00:00Z",
              workflow_steps: [
                { id: 10, workflow_id: 1, step_order: 1, module_name: "archive", config: {} },
                {
                  id: 11,
                  workflow_id: 1,
                  step_order: 2,
                  module_name: "tag-order",
                  config: { tags: ["auto-archived"] },
                },
              ],
            },
          ],
          error: null,
        },
        // Both the Archive and Tag Order steps write to "orders" — one
        // queued response per call, in step order.
        orders: [
          { data: null, error: null }, // archiveModule's update
          { data: null, error: null }, // tagOrderModule's update
        ],
        // Interleaved per step: circuit-breaker read, then history insert.
        workflow_executions: [CIRCUIT_CLOSED, INSERT_OK, CIRCUIT_CLOSED, INSERT_OK],
      },
    });
    holder.client = client;

    await handleEvent(7, "order.created", order);

    // Workflow Manager resolved on the right (shop_id, trigger_event, is_active).
    const workflowsBuilder = builders.workflows[0];
    expect(workflowsBuilder.eq).toHaveBeenNthCalledWith(1, "shop_id", 7);
    expect(workflowsBuilder.eq).toHaveBeenNthCalledWith(2, "trigger_event", "order.created");
    expect(workflowsBuilder.eq).toHaveBeenNthCalledWith(3, "is_active", true);

    // Archive really ran: orders.archived_at got stamped.
    expect(builders.orders[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) })
    );

    // Tag Order really ran, with the order's *existing* tag preserved
    // alongside the new one — proves the real order object flowed through
    // Dispatch -> Engine -> the module unchanged.
    expect(builders.orders[1].update).toHaveBeenCalledWith({
      tags: ["existing-tag", "auto-archived"],
    });

    // Execution History really recorded both steps as successes.
    const inserted = insertedRows(builders, "workflow_executions");
    expect(inserted).toContainEqual(
      expect.objectContaining({ workflow_id: 1, step_order: 1, module_name: "archive", status: "success" })
    );
    expect(inserted).toContainEqual(
      expect.objectContaining({ workflow_id: 1, step_order: 2, module_name: "tag-order", status: "success" })
    );
  });

  it("isolates a failing step (missing module) from the rest of the workflow, end to end", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflows: {
          data: [
            {
              id: 2,
              shop_id: 7,
              name: "Broken then archive",
              trigger_event: "order.created",
              is_active: true,
              activated_at: null,
              created_at: "2026-01-01T00:00:00Z",
              workflow_steps: [
                { id: 20, workflow_id: 2, step_order: 1, module_name: "does-not-exist", config: {} },
                { id: 21, workflow_id: 2, step_order: 2, module_name: "archive", config: {} },
              ],
            },
          ],
          error: null,
        },
        orders: { data: null, error: null },
        // Step 1 (unregistered module) never reaches the circuit breaker —
        // the engine returns early for it — so only step 2 does a
        // circuit-breaker read before its own history insert.
        workflow_executions: [INSERT_OK, CIRCUIT_CLOSED, INSERT_OK],
      },
    });
    holder.client = client;

    await handleEvent(7, "order.created", order);

    // Step 2 (archive) still ran despite step 1 referencing a nonexistent module.
    expect(builders.orders[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) })
    );
    const inserted = insertedRows(builders, "workflow_executions");
    expect(inserted).toContainEqual(
      expect.objectContaining({ status: "failed", module_name: "does-not-exist" })
    );
    expect(inserted).toContainEqual(
      expect.objectContaining({ status: "success", module_name: "archive" })
    );
  });

  it("never runs a Draft (is_active: false) workflow — the Manager's own filter excludes it before the Engine ever sees it", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflows: { data: [], error: null } },
    });
    holder.client = client;

    await handleEvent(7, "order.created", order);

    expect(builders.orders).toBeUndefined();
    expect(builders.workflow_executions).toBeUndefined();
  });

  it("opens the circuit after 3 consecutive failures for the same step, skipping the module on the 4th order", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflows: {
          data: [
            {
              id: 3,
              shop_id: 7,
              name: "Flaky archive step",
              trigger_event: "order.created",
              is_active: true,
              activated_at: null,
              created_at: "2026-01-01T00:00:00Z",
              // A registered module (unlike the "isolates a failing step"
              // test above) — the circuit breaker only guards steps that
              // actually resolve to a module; an unregistered module_name
              // is a config problem the engine reports every time, not
              // something the breaker should ever suppress.
              workflow_steps: [
                { id: 30, workflow_id: 3, step_order: 1, module_name: "archive", config: {} },
              ],
            },
          ],
          error: null,
        },
        // 3 prior failed attempts for this exact step, most-recent-first —
        // exactly what the circuit breaker's own query expects.
        workflow_executions: [
          { data: [{ status: "failed" }, { status: "failed" }, { status: "failed" }], error: null },
          INSERT_OK,
        ],
      },
    });
    holder.client = client;

    await handleEvent(7, "order.created", order);

    // The Archive module itself was never invoked — "orders" was never
    // touched at all — proving the breaker skipped the call rather than
    // running it and separately failing.
    expect(builders.orders).toBeUndefined();

    const inserted = insertedRows(builders, "workflow_executions");
    expect(inserted).toContainEqual(
      expect.objectContaining({ status: "failed", message: expect.stringContaining("Circuit open") })
    );
  });
});
