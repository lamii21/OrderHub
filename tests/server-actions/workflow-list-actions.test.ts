import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));

import { createWorkflow, deleteWorkflow } from "@/app/shops/[id]/workflows/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createWorkflow", () => {
  it("redirects to the shop list on an invalid shop_id, without touching the database", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      createWorkflow(formData({ shop_id: "abc", name: "Welcome flow", trigger_event: "order.created" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("redirects with an error on an empty name, without touching the database", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      createWorkflow(formData({ shop_id: "1", name: "  ", trigger_event: "order.created" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/new\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("redirects with an error on an invalid trigger event", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      createWorkflow(formData({ shop_id: "1", name: "Welcome flow", trigger_event: "order.paid" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/new\?error=/);
  });

  it("inserts as a Draft (no is_active field — relies on the schema default) and redirects to the editor", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflows: { data: { id: 42 }, error: null } },
    });
    holder.client = client;

    await expect(
      createWorkflow(formData({ shop_id: "1", name: "Welcome flow", trigger_event: "order.created" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows/42");

    const payload = builders.workflows[0].insert.mock.calls[0][0];
    expect(payload).toEqual({ shop_id: 1, name: "Welcome flow", trigger_event: "order.created" });
    expect(payload).not.toHaveProperty("is_active");
  });

  it("redirects with an error when the insert fails", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: null, error: { message: "insert failed" } } },
    });
    holder.client = client;

    await expect(
      createWorkflow(formData({ shop_id: "1", name: "Welcome flow", trigger_event: "order.created" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\/new\?error=/);
  });
});

describe("deleteWorkflow", () => {
  it("redirects to the shop list on an invalid shop_id, without touching the database", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      deleteWorkflow(formData({ shop_id: "abc", workflow_id: "42" }))
    ).rejects.toThrow(/REDIRECT:\/shops\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("redirects to the workflow list on an invalid workflow_id, without touching the database", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      deleteWorkflow(formData({ shop_id: "1", workflow_id: "abc" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?error=" + encodeURIComponent("Invalid workflow."));
    expect(client.from).not.toHaveBeenCalled();
  });

  it("deletes the workflow and redirects with deleted=1 (steps cascade in the database)", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflows: { data: null, error: null } },
    });
    holder.client = client;

    await expect(
      deleteWorkflow(formData({ shop_id: "1", workflow_id: "42" }))
    ).rejects.toThrow("REDIRECT:/shops/1/workflows?deleted=1");

    expect(builders.workflows[0].eq).toHaveBeenCalledWith("id", 42);
  });

  it("redirects with an error when the delete fails", async () => {
    const { client } = createMockSupabase({
      responses: { workflows: { data: null, error: { message: "fk violation" } } },
    });
    holder.client = client;

    await expect(
      deleteWorkflow(formData({ shop_id: "1", workflow_id: "42" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/workflows\?error=/);
  });
});
