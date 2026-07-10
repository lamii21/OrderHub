import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { notesModule } from "@/lib/automation-modules/notes";
import type { Order } from "@/types/order";

const order = { id: 1, customer_name: "Amina", product: "T-Shirt" } as Order;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notesModule.validateConfig", () => {
  it("rejects empty content", () => {
    expect(notesModule.validateConfig!({ content: "" })).not.toBeNull();
  });

  it("accepts non-empty content", () => {
    expect(notesModule.validateConfig!({ content: "Called the customer." })).toBeNull();
  });
});

describe("notesModule.run", () => {
  it("inserts a rendered note and returns its id", async () => {
    const { client, builders } = createMockSupabase({
      responses: { order_notes: { data: { id: 99 }, error: null } },
    });
    holder.client = client;

    const result = await notesModule.run(order, { content: "Note for {{customer_name}}" }, {});

    expect(builders.order_notes[0].insert).toHaveBeenCalledWith({
      order_id: 1,
      content: "Note for Amina",
    });
    expect(result).toEqual({ success: true, message: "Note added.", data: { noteId: 99 } });
  });

  it("reports a structured failure when the insert fails", async () => {
    const { client } = createMockSupabase({
      responses: { order_notes: { data: null, error: { message: "insert failed" } } },
    });
    holder.client = client;

    const result = await notesModule.run(order, { content: "Note" }, {});

    expect(result).toEqual({ success: false, message: "Could not save the note." });
  });
});
