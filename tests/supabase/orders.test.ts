import { describe, it, expect } from "vitest";
import { applyOrderStatusChange } from "@/lib/orders";
import { createMockSupabase } from "../mocks/supabase";

describe("applyOrderStatusChange", () => {
  it("returns 'error' when the order can't be loaded", async () => {
    const { client } = createMockSupabase({
      responses: { orders: { data: null, error: { message: "not found" } } },
    });

    const result = await applyOrderStatusChange(client as never, 1, "confirmed", "user-1");

    expect(result).toEqual({ outcome: "error" });
  });

  it("returns 'unchanged' and writes nothing when the status is already that value", async () => {
    const { client, builders } = createMockSupabase({
      responses: { orders: { data: { status: "confirmed" }, error: null } },
    });

    const result = await applyOrderStatusChange(client as never, 1, "confirmed", "user-1");

    expect(result).toEqual({ outcome: "unchanged" });
    expect(builders.order_history).toBeUndefined();
  });

  it("updates the order and records order_history on a real change", async () => {
    const updatedOrder = {
      id: 1,
      status: "shipped",
      shop_id: 7,
      shops: { name: "Acme", platform: "Shopify" },
    };
    const { client, builders } = createMockSupabase({
      responses: {
        orders: [
          { data: { status: "confirmed" }, error: null },
          { data: updatedOrder, error: null },
        ],
        order_history: { data: null, error: null },
      },
    });

    const result = await applyOrderStatusChange(client as never, 1, "shipped", "user-1");

    expect(result).toEqual({ outcome: "updated", previousStatus: "confirmed", order: updatedOrder });

    // The update actually targeted the right row with the right status.
    const ordersBuilders = builders.orders;
    expect(ordersBuilders[1].update).toHaveBeenCalledWith({ status: "shipped" });
    expect(ordersBuilders[1].eq).toHaveBeenCalledWith("id", 1);

    // order_history got the previous/new status and the provided changedBy.
    expect(builders.order_history[0].insert).toHaveBeenCalledWith({
      order_id: 1,
      previous_status: "confirmed",
      new_status: "shipped",
      changed_by: "user-1",
    });
  });

  it("supports changedBy: null for system-initiated changes (the Update Status module)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        orders: [
          { data: { status: "pending" }, error: null },
          { data: { id: 2, status: "cancelled", shop_id: 3, shops: null }, error: null },
        ],
        order_history: { data: null, error: null },
      },
    });

    await applyOrderStatusChange(client as never, 2, "cancelled", null);

    expect(builders.order_history[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ changed_by: null })
    );
  });

  it("returns 'error' when the update itself fails", async () => {
    const { client } = createMockSupabase({
      responses: {
        orders: [
          { data: { status: "confirmed" }, error: null },
          { data: null, error: { message: "constraint violation" } },
        ],
      },
    });

    const result = await applyOrderStatusChange(client as never, 1, "shipped", "user-1");

    expect(result).toEqual({ outcome: "error" });
  });

  it("still reports 'updated' when order_history insert fails (best-effort)", async () => {
    const updatedOrder = { id: 1, status: "shipped", shop_id: 7, shops: null };
    const { client } = createMockSupabase({
      responses: {
        orders: [
          { data: { status: "confirmed" }, error: null },
          { data: updatedOrder, error: null },
        ],
        order_history: { data: null, error: { message: "insert failed" } },
      },
    });

    const result = await applyOrderStatusChange(client as never, 1, "shipped", "user-1");

    expect(result.outcome).toBe("updated");
  });

  // Regression test for the optimistic-concurrency fix: the update is now
  // guarded by .eq("status", previousStatus) in addition to .eq("id", ...).
  it("guards the update with the previously-read status, not just the id", async () => {
    const updatedOrder = { id: 1, status: "shipped", shop_id: 7, shops: null };
    const { client, builders } = createMockSupabase({
      responses: {
        orders: [
          { data: { status: "confirmed" }, error: null },
          { data: updatedOrder, error: null },
        ],
        order_history: { data: null, error: null },
      },
    });

    await applyOrderStatusChange(client as never, 1, "shipped", "user-1");

    expect(builders.orders[1].eq).toHaveBeenCalledWith("id", 1);
    expect(builders.orders[1].eq).toHaveBeenCalledWith("status", "confirmed");
  });

  // Regression test for the actual race this guard closes: a concurrent
  // write (another tab, the Update Status module) already moved the order
  // off the status this call read, between the read and this write. The
  // guarded .eq("status", ...) predicate then matches zero rows, and
  // .single() turns that into the same error PostgREST already raises for
  // an RLS-blocked update — no silent, wrong-audit-trail "success".
  it("reports 'error' (not a silent success) when a concurrent write already changed the status", async () => {
    const { client } = createMockSupabase({
      responses: {
        orders: [
          { data: { status: "confirmed" }, error: null },
          // Simulates PostgREST's .single() response when the guarded
          // update matched zero rows: an error, no data.
          { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } },
        ],
      },
    });

    const result = await applyOrderStatusChange(client as never, 1, "shipped", "user-1");

    expect(result).toEqual({ outcome: "error" });
  });
});
