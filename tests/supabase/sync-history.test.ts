import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { recordSyncHistory } from "@/lib/sync-history";

describe("recordSyncHistory", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("computes duration_ms from startedAt to now and inserts a success row", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(new Date("2026-01-01T00:00:02.500Z"));

    const { client, builders } = createMockSupabase({
      responses: { sync_history: { data: null, error: null } },
    });
    holder.client = client;

    await recordSyncHistory({
      shopId: 1,
      type: "orders",
      startedAt,
      status: "success",
      importedCount: 5,
    });

    expect(builders.sync_history[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        shop_id: 1,
        type: "orders",
        status: "success",
        duration_ms: 2500,
        imported_count: 5,
        message: null,
      })
    );

    vi.useRealTimers();
  });

  it("records a failure with a message and null imported_count", async () => {
    const { client, builders } = createMockSupabase({
      responses: { sync_history: { data: null, error: null } },
    });
    holder.client = client;

    await recordSyncHistory({
      shopId: 2,
      type: "products",
      startedAt: new Date(),
      status: "failed",
      message: "Could not sync products.",
    });

    expect(builders.sync_history[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        shop_id: 2,
        type: "products",
        status: "failed",
        imported_count: null,
        message: "Could not sync products.",
      })
    );
  });

  it("logs but never throws when the insert fails", async () => {
    const { client } = createMockSupabase({
      responses: { sync_history: { data: null, error: { message: "insert failed" } } },
    });
    holder.client = client;

    await expect(
      recordSyncHistory({ shopId: 1, type: "orders", startedAt: new Date(), status: "success" })
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
