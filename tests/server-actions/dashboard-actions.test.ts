import { describe, it, expect, vi, beforeEach } from "vitest";

const { applyOrderStatusChange, handleEvent, revalidatePath, getUser } = vi.hoisted(() => ({
  applyOrderStatusChange: vi.fn(),
  handleEvent: vi.fn(),
  revalidatePath: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/orders", () => ({ applyOrderStatusChange }));
vi.mock("@/lib/workflows/dispatch", () => ({ handleEvent }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser } })),
}));

import { updateOrderStatus } from "@/app/dashboard/actions";

beforeEach(() => {
  applyOrderStatusChange.mockReset();
  handleEvent.mockReset();
  revalidatePath.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateOrderStatus", () => {
  it("throws on an invalid status without touching the database", async () => {
    await expect(updateOrderStatus(1, "not-a-status")).rejects.toThrow("Invalid status");
    expect(applyOrderStatusChange).not.toHaveBeenCalled();
  });

  it("passes the logged-in user's id as changedBy", async () => {
    applyOrderStatusChange.mockResolvedValue({ outcome: "unchanged" });

    await updateOrderStatus(1, "confirmed");

    expect(applyOrderStatusChange).toHaveBeenCalledWith(expect.anything(), 1, "confirmed", "user-1");
  });

  it("returns quietly with no dispatch or revalidation when nothing changed", async () => {
    applyOrderStatusChange.mockResolvedValue({ outcome: "unchanged" });

    await updateOrderStatus(1, "confirmed");

    expect(handleEvent).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("throws when the change fails", async () => {
    applyOrderStatusChange.mockResolvedValue({ outcome: "error" });

    await expect(updateOrderStatus(1, "confirmed")).rejects.toThrow("Could not update order status.");
  });

  it("dispatches only order.status_changed for a non-cancelled transition", async () => {
    applyOrderStatusChange.mockResolvedValue({
      outcome: "updated",
      previousStatus: "pending",
      order: { id: 1, shop_id: 5 },
    });

    await updateOrderStatus(1, "confirmed");

    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(handleEvent).toHaveBeenCalledWith(5, "order.status_changed", { id: 1, shop_id: 5 });
  });

  it("dispatches both order.status_changed and order.cancelled when the new status is cancelled", async () => {
    applyOrderStatusChange.mockResolvedValue({
      outcome: "updated",
      previousStatus: "pending",
      order: { id: 1, shop_id: 5 },
    });

    await updateOrderStatus(1, "cancelled");

    expect(handleEvent).toHaveBeenCalledTimes(2);
    expect(handleEvent).toHaveBeenNthCalledWith(1, 5, "order.status_changed", { id: 1, shop_id: 5 });
    expect(handleEvent).toHaveBeenNthCalledWith(2, 5, "order.cancelled", { id: 1, shop_id: 5 });
  });

  it("skips dispatch entirely when the order has no shop_id", async () => {
    applyOrderStatusChange.mockResolvedValue({
      outcome: "updated",
      previousStatus: "pending",
      order: { id: 1, shop_id: null },
    });

    await updateOrderStatus(1, "confirmed");

    expect(handleEvent).not.toHaveBeenCalled();
  });

  it("never lets a dispatch failure propagate out of the Server Action", async () => {
    applyOrderStatusChange.mockResolvedValue({
      outcome: "updated",
      previousStatus: "pending",
      order: { id: 1, shop_id: 5 },
    });
    handleEvent.mockRejectedValue(new Error("engine exploded"));

    await expect(updateOrderStatus(1, "confirmed")).resolves.toBeUndefined();
  });

  it("revalidates the dashboard and the order's own page after a real change", async () => {
    applyOrderStatusChange.mockResolvedValue({
      outcome: "updated",
      previousStatus: "pending",
      order: { id: 42, shop_id: 5 },
    });

    await updateOrderStatus(42, "confirmed");

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/orders/42");
  });
});
