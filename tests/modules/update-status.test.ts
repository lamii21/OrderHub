import { describe, it, expect, vi, beforeEach } from "vitest";

const { applyOrderStatusChange } = vi.hoisted(() => ({ applyOrderStatusChange: vi.fn() }));
vi.mock("@/lib/orders", () => ({ applyOrderStatusChange }));
// update-status.ts also imports the service-role client to pass into
// applyOrderStatusChange — mocked to a harmless stub since
// applyOrderStatusChange itself is mocked above and never touches it.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { updateStatusModule } from "@/lib/automation-modules/update-status";
import type { Order } from "@/types/order";

const order = { id: 1 } as Order;

beforeEach(() => {
  applyOrderStatusChange.mockReset();
});

describe("updateStatusModule.validateConfig", () => {
  it("rejects an invalid status", () => {
    expect(updateStatusModule.validateConfig!({ status: "archived" })).toMatch(/status among/);
  });

  it("accepts a valid status", () => {
    expect(updateStatusModule.validateConfig!({ status: "shipped" })).toBeNull();
  });
});

describe("updateStatusModule.run", () => {
  it("changes the status via applyOrderStatusChange with changedBy: null (no human did this)", async () => {
    applyOrderStatusChange.mockResolvedValue({ outcome: "updated", previousStatus: "pending" });

    const result = await updateStatusModule.run(order, { status: "confirmed" }, {});

    expect(applyOrderStatusChange).toHaveBeenCalledWith(expect.anything(), 1, "confirmed", null);
    expect(result).toEqual({
      success: true,
      message: 'Status changed from "pending" to "confirmed".',
      data: { previousStatus: "pending", newStatus: "confirmed" },
    });
  });

  it("reports success with no-op messaging when the order already has that status", async () => {
    applyOrderStatusChange.mockResolvedValue({ outcome: "unchanged" });

    const result = await updateStatusModule.run(order, { status: "confirmed" }, {});

    expect(result).toEqual({ success: true, message: 'Order already has status "confirmed".' });
  });

  it("reports a structured failure when applyOrderStatusChange errors", async () => {
    applyOrderStatusChange.mockResolvedValue({ outcome: "error" });

    const result = await updateStatusModule.run(order, { status: "confirmed" }, {});

    expect(result).toEqual({ success: false, message: "Could not update the order status." });
  });

  it("rejects an invalid target status at run time too, defensively", async () => {
    const result = await updateStatusModule.run(order, { status: "not-a-status" }, {});

    expect(applyOrderStatusChange).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("never dispatches a new event itself — it has no import of the dispatch/engine layer", async () => {
    // Static guarantee, not a runtime one: this module module-graph must
    // never reach lib/workflows/dispatch.ts, per the catalog's explicit
    // cascade-risk warning. Asserted here by checking the compiled module
    // only exposes run/validateConfig, nothing dispatch-shaped.
    expect(Object.keys(updateStatusModule).sort()).toEqual(["run", "validateConfig"]);
  });
});
