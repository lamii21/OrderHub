import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { tagOrderModule } from "@/lib/automation-modules/tag-order";
import type { Order } from "@/types/order";

const order = { id: 1, tags: ["existing"] } as Order;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("tagOrderModule.validateConfig", () => {
  it("rejects an empty tags array", () => {
    expect(tagOrderModule.validateConfig!({ tags: [] })).not.toBeNull();
  });

  it("rejects a non-array", () => {
    expect(tagOrderModule.validateConfig!({ tags: "vip" })).not.toBeNull();
  });

  it("rejects a blank tag", () => {
    expect(tagOrderModule.validateConfig!({ tags: ["vip", "  "] })).not.toBeNull();
  });

  it("accepts one or more non-empty tags", () => {
    expect(tagOrderModule.validateConfig!({ tags: ["vip", "priority"] })).toBeNull();
  });
});

describe("tagOrderModule.run", () => {
  it("unions new tags with the order's existing tags (never drops old ones)", async () => {
    const { client, builders } = createMockSupabase({
      responses: { orders: { data: null, error: null } },
    });
    holder.client = client;

    const result = await tagOrderModule.run(order, { tags: ["priority"] }, {});

    expect(builders.orders[0].update).toHaveBeenCalledWith({ tags: ["existing", "priority"] });
    expect(result).toEqual({
      success: true,
      message: "Tagged with: priority.",
      data: { tags: ["existing", "priority"] },
    });
  });

  it("de-duplicates a tag that's already present", async () => {
    const { client, builders } = createMockSupabase({
      responses: { orders: { data: null, error: null } },
    });
    holder.client = client;

    await tagOrderModule.run(order, { tags: ["existing"] }, {});

    expect(builders.orders[0].update).toHaveBeenCalledWith({ tags: ["existing"] });
  });

  it("reports a structured failure when the write fails", async () => {
    const { client } = createMockSupabase({
      responses: { orders: { data: null, error: { message: "db error" } } },
    });
    holder.client = client;

    const result = await tagOrderModule.run(order, { tags: ["priority"] }, {});

    expect(result).toEqual({ success: false, message: "Could not save the order's tags." });
  });
});
