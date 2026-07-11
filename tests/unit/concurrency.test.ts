import { describe, it, expect, vi } from "vitest";
import { runWithConcurrency } from "@/lib/concurrency";

describe("runWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never runs more than `concurrency` workers at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await runWithConcurrency(items, 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("uses fewer workers than concurrency when there are fewer items", async () => {
    const worker = vi.fn(async () => {});
    await runWithConcurrency(["a", "b"], 10, worker);

    expect(worker).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an empty list", async () => {
    const worker = vi.fn(async () => {});
    await runWithConcurrency([], 5, worker);

    expect(worker).not.toHaveBeenCalled();
  });

  it("lets one item's rejection propagate without silently swallowing it", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 3, async (item) => {
        if (item === 2) throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});
