import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { resolveWorkflows } from "@/lib/workflows/manager";

describe("resolveWorkflows", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      responses: {
        workflows: {
          data: [
            {
              id: 1,
              shop_id: 5,
              name: "Workflow A",
              trigger_event: "order.created",
              is_active: true,
              activated_at: "2026-01-01T00:00:00Z",
              created_at: "2026-01-01T00:00:00Z",
              workflow_steps: [
                { id: 20, workflow_id: 1, step_order: 2, module_name: "tag-order", config: {} },
                { id: 21, workflow_id: 1, step_order: 1, module_name: "whatsapp", config: {} },
              ],
            },
          ],
          error: null,
        },
      },
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
});
