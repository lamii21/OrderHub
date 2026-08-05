import { describe, it, expect } from "vitest";
import { getTool, getEnabledTools } from "@/lib/agent/tools/registry";

describe("getTool", () => {
  it("returns null for any name, since the registry starts empty", () => {
    expect(getTool("check_stock")).toBeNull();
    expect(getTool("anything")).toBeNull();
  });
});

describe("getEnabledTools", () => {
  it("returns an empty array regardless of what a shop has enabled, since nothing is registered yet", () => {
    expect(getEnabledTools([])).toEqual([]);
    expect(getEnabledTools(["check_stock", "apply_promo_code"])).toEqual([]);
  });
});
