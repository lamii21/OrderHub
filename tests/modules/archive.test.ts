import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { archiveModule } from "@/lib/automation-modules/archive";
import type { Order } from "@/types/order";

const order = { id: 42 } as Order;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("archiveModule.run", () => {
  it("stamps archived_at on the order and returns success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { client, builders } = createMockSupabase({
      responses: { orders: { data: null, error: null } },
    });
    holder.client = client;

    const result = await archiveModule.run(order, {}, {});

    expect(builders.orders[0].update).toHaveBeenCalledWith({
      archived_at: "2026-01-01T00:00:00.000Z",
    });
    expect(builders.orders[0].eq).toHaveBeenCalledWith("id", 42);
    expect(result).toEqual({ success: true, message: "Order archived." });

    vi.useRealTimers();
  });

  it("reports a structured failure when the write fails", async () => {
    const { client } = createMockSupabase({
      responses: { orders: { data: null, error: { message: "db error" } } },
    });
    holder.client = client;

    const result = await archiveModule.run(order, {}, {});

    expect(result).toEqual({ success: false, message: "Could not archive the order." });
  });

  it("has no validateConfig (nothing to configure)", () => {
    expect(archiveModule.validateConfig).toBeUndefined();
  });
});
