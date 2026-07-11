import { describe, it, expect } from "vitest";
import { AVAILABLE_MODULES } from "@/lib/automation-modules";
import { MODULE_CATALOG, MODULE_CATALOG_NAMES, getModuleCatalogEntry, summarizeStepConfig } from "@/lib/automation-modules/catalog";

describe("MODULE_CATALOG", () => {
  it("has exactly one entry per module in AVAILABLE_MODULES — no drift between the two", () => {
    expect(MODULE_CATALOG_NAMES.sort()).toEqual([...AVAILABLE_MODULES].sort());
  });

  it.each(AVAILABLE_MODULES)("%s has a non-empty name, icon, purpose, and configHint", (name) => {
    const entry = MODULE_CATALOG[name];
    expect(entry.name.length).toBeGreaterThan(0);
    expect(entry.icon.length).toBeGreaterThan(0);
    expect(entry.purpose.length).toBeGreaterThan(0);
    expect(entry.configHint.length).toBeGreaterThan(0);
    expect(["action", "control"]).toContain(entry.category);
  });

  it("categorizes exactly Delay and Condition as control modules", () => {
    const controlModules = AVAILABLE_MODULES.filter((name) => MODULE_CATALOG[name].category === "control");
    expect(controlModules.sort()).toEqual(["condition", "delay"]);
  });
});

describe("getModuleCatalogEntry", () => {
  it("returns a real entry for a registered module", () => {
    expect(getModuleCatalogEntry("email").purpose).toMatch(/email/i);
  });

  it("returns a safe fallback for an unregistered module instead of throwing", () => {
    const entry = getModuleCatalogEntry("carrier-pigeon");
    expect(entry.icon).toBeTruthy();
    expect(entry.purpose).toMatch(/not available/i);
  });
});

describe("summarizeStepConfig", () => {
  it("summarizes tag-order by listing the tags", () => {
    expect(summarizeStepConfig("tag-order", { tags: ["vip", "priority"] })).toBe("Add tags: vip, priority");
    expect(summarizeStepConfig("tag-order", {})).toBe("No tags configured yet.");
  });

  it("summarizes update-status by quoting the target status", () => {
    expect(summarizeStepConfig("update-status", { status: "shipped" })).toBe('Set status to "shipped"');
    expect(summarizeStepConfig("update-status", {})).toBe("No target status configured yet.");
  });

  it("summarizes condition as a field/operator/value expression", () => {
    expect(summarizeStepConfig("condition", { field: "price", operator: ">", value: 100 })).toBe("price > 100");
    expect(summarizeStepConfig("condition", {})).toBe("No condition configured yet.");
  });

  it("summarizes delay by naming the duration", () => {
    expect(summarizeStepConfig("delay", { duration: "2h" })).toBe("Wait 2h");
  });

  it("summarizes archive as needing no configuration", () => {
    expect(summarizeStepConfig("archive", {})).toBe("No configuration needed.");
  });

  it("falls back to the first recognized generic field for any other module", () => {
    expect(summarizeStepConfig("email", { subject: "Order confirmed", body: "..." })).toBe("Order confirmed");
    expect(summarizeStepConfig("webhook", { url: "https://example.com/hook" })).toBe("https://example.com/hook");
    expect(summarizeStepConfig("whatsapp", {})).toBe("No configuration set yet.");
  });
});
