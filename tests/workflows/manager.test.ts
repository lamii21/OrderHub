import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { resolveWorkflows, invalidateWorkflowCache } from "@/lib/workflows/manager";

function workflowRow(overrides: Partial<{ id: number; steps: unknown[] }> = {}) {
  return {
    id: overrides.id ?? 1,
    shop_id: 5,
    name: "Workflow A",
    trigger_event: "order.created",
    is_active: true,
    activated_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    workflow_steps: overrides.steps ?? [
      { id: 20, workflow_id: 1, step_order: 2, module_name: "tag-order", config: {} },
      { id: 21, workflow_id: 1, step_order: 1, module_name: "whatsapp", config: {} },
    ],
  };
}

describe("resolveWorkflows", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The cache is module-scoped (persists across tests in this file) —
    // every test uses shopId 5 with one of the 3 real event types, so
    // without this reset, whichever test runs first for a given
    // (shopId, eventType) pair would "win" and every later test reusing
    // that pair would silently get its cached result instead of querying.
    invalidateWorkflowCache();
  });

  it("filters by shop_id, trigger_event, and is_active = true", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflows: { data: [], error: null } },
    });
    holder.client = client;

    await resolveWorkflows(5, "order.created");

    const builder = builders.workflows[0];
    expect(builder.eq).toHaveBeenNthCalledWith(1, "shop_id", 5);
    expect(builder.eq).toHaveBeenNthCalledWith(2, "trigger_event", "order.created");
    expect(builder.eq).toHaveBeenNthCalledWith(3, "is_active", true);
  });

  it("returns each workflow's steps already sorted by step_order", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: [workflowRow()], error: null } },
    });
    holder.client = client;

    const workflows = await resolveWorkflows(5, "order.created");

    expect(workflows).toHaveLength(1);
    expect(workflows[0].steps.map((s) => s.module_name)).toEqual(["whatsapp", "tag-order"]);
    // The raw workflow_steps key never leaks into the mapped shape.
    expect(workflows[0]).not.toHaveProperty("workflow_steps");
  });

  it("returns an empty array (not an error) when nothing matches", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: [], error: null } },
    });
    holder.client = client;

    await expect(resolveWorkflows(5, "order.cancelled")).resolves.toEqual([]);
  });

  it("returns an empty array on a query error, never throws", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(resolveWorkflows(5, "order.created")).resolves.toEqual([]);
  });

  describe("validation", () => {
    it("rejects a non-positive shopId without querying", async () => {
      const { client } = createMockSupabase({ responses: { workflows: { data: [], error: null } } });
      holder.client = client;

      await expect(resolveWorkflows(0, "order.created")).resolves.toEqual([]);
      await expect(resolveWorkflows(-1, "order.created")).resolves.toEqual([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it("rejects a non-integer shopId without querying", async () => {
      const { client } = createMockSupabase({ responses: { workflows: { data: [], error: null } } });
      holder.client = client;

      await expect(resolveWorkflows(1.5, "order.created")).resolves.toEqual([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it("rejects an eventType outside the closed vocabulary without querying", async () => {
      const { client } = createMockSupabase({ responses: { workflows: { data: [], error: null } } });
      holder.client = client;

      // @ts-expect-error deliberately passing an invalid event type to
      // exercise the runtime guard a TypeScript-bypassing caller would hit.
      await expect(resolveWorkflows(5, "order.paid")).resolves.toEqual([]);
      expect(client.from).not.toHaveBeenCalled();
    });
  });

  describe("filtering workflows with no steps", () => {
    it("excludes a resolved workflow that has zero steps", async () => {
      const { client } = createMockSupabase({
        responses: { workflows: { data: [workflowRow({ id: 1, steps: [] })], error: null } },
      });
      holder.client = client;

      const workflows = await resolveWorkflows(5, "order.created");

      expect(workflows).toEqual([]);
    });

    it("keeps a workflow with steps alongside one filtered out for having none", async () => {
      const { client } = createMockSupabase({
        responses: {
          workflows: {
            data: [workflowRow({ id: 1, steps: [] }), workflowRow({ id: 2 })],
            error: null,
          },
        },
      });
      holder.client = client;

      const workflows = await resolveWorkflows(5, "order.created");

      expect(workflows.map((w) => w.id)).toEqual([2]);
    });
  });

  describe("caching", () => {
    it("serves a second call for the same (shopId, eventType) from cache, without querying again", async () => {
      const { client, builders } = createMockSupabase({
        responses: { workflows: { data: [workflowRow()], error: null } },
      });
      holder.client = client;

      const first = await resolveWorkflows(5, "order.created");
      const second = await resolveWorkflows(5, "order.created");

      expect(builders.workflows).toHaveLength(1); // only one real query happened
      expect(second).toEqual(first);
    });

    it("queries independently per event type, even for the same shop", async () => {
      const { client, builders } = createMockSupabase({
        responses: {
          workflows: [
            { data: [workflowRow({ id: 1 })], error: null },
            { data: [workflowRow({ id: 2 })], error: null },
          ],
        },
      });
      holder.client = client;

      const created = await resolveWorkflows(5, "order.created");
      const cancelled = await resolveWorkflows(5, "order.cancelled");

      expect(builders.workflows).toHaveLength(2);
      expect(created[0].id).toBe(1);
      expect(cancelled[0].id).toBe(2);
    });

    it("queries independently per shop, even for the same event type", async () => {
      const { client, builders } = createMockSupabase({
        responses: {
          workflows: [
            { data: [workflowRow({ id: 1 })], error: null },
            { data: [workflowRow({ id: 2 })], error: null },
          ],
        },
      });
      holder.client = client;

      await resolveWorkflows(5, "order.created");
      await resolveWorkflows(6, "order.created");

      expect(builders.workflows).toHaveLength(2);
    });

    it("invalidateWorkflowCache(shopId, eventType) forces the next call to query again", async () => {
      const { client, builders } = createMockSupabase({
        responses: {
          workflows: [
            { data: [workflowRow({ id: 1 })], error: null },
            { data: [workflowRow({ id: 2 })], error: null },
          ],
        },
      });
      holder.client = client;

      await resolveWorkflows(5, "order.created");
      invalidateWorkflowCache(5, "order.created");
      const afterInvalidate = await resolveWorkflows(5, "order.created");

      expect(builders.workflows).toHaveLength(2);
      expect(afterInvalidate[0].id).toBe(2);
    });

    it("invalidateWorkflowCache(shopId) clears every event type for that shop, but not other shops", async () => {
      const { client, builders } = createMockSupabase({
        responses: {
          workflows: [
            { data: [workflowRow({ id: 1 })], error: null }, // shop 5, created (1st call)
            { data: [workflowRow({ id: 1 })], error: null }, // shop 6, created (2nd call) — untouched by invalidation
            { data: [workflowRow({ id: 2 })], error: null }, // shop 5, created (after invalidation, re-queried)
          ],
        },
      });
      holder.client = client;

      await resolveWorkflows(5, "order.created");
      await resolveWorkflows(6, "order.created");
      invalidateWorkflowCache(5);

      await resolveWorkflows(6, "order.created"); // still cached — no new query
      const shop5Again = await resolveWorkflows(5, "order.created"); // re-queried

      expect(builders.workflows).toHaveLength(3);
      expect(shop5Again[0].id).toBe(2);
    });

    it("does not cache a query error, so the next call tries again", async () => {
      const { client, builders } = createMockSupabase({
        responses: {
          workflows: [
            { data: null, error: { message: "db down" } },
            { data: [workflowRow()], error: null },
          ],
        },
      });
      holder.client = client;

      const failed = await resolveWorkflows(5, "order.created");
      const retried = await resolveWorkflows(5, "order.created");

      expect(failed).toEqual([]);
      expect(retried).toHaveLength(1);
      expect(builders.workflows).toHaveLength(2);
    });
  });
});
