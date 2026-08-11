import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCustomerStats } = vi.hoisted(() => ({ getCustomerStats: vi.fn() }));

vi.mock("@/lib/agent/tools/customers/repository", () => ({ getCustomerStats }));

import { getCustomerStatsForCustomer } from "@/lib/agent/tools/customers/service";

const stats = { order_count: 3, ltv: 900, last_order_at: "2026-08-01T00:00:00.000Z" };

beforeEach(() => {
  getCustomerStats.mockReset();
});

describe("getCustomerStatsForCustomer", () => {
  it("returns found:true with the stats when the repository finds a row", async () => {
    getCustomerStats.mockResolvedValue(stats);

    const result = await getCustomerStatsForCustomer(15, 42);

    expect(getCustomerStats).toHaveBeenCalledWith(15, 42);
    expect(result).toEqual({ found: true, stats });
  });

  it("returns found:false when the repository returns null", async () => {
    getCustomerStats.mockResolvedValue(null);

    const result = await getCustomerStatsForCustomer(15, 42);

    expect(result).toEqual({ found: false });
  });
});
