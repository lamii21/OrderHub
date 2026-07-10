import { describe, it, expect } from "vitest";
import { getAutomationModule, AVAILABLE_MODULES } from "@/lib/automation-modules";

describe("automation module registry", () => {
  it("registers exactly the 16 modules from the Automation Modules catalog", () => {
    expect(AVAILABLE_MODULES.sort()).toEqual(
      [
        "whatsapp",
        "delivery",
        "email",
        "google-sheets",
        "webhook",
        "tag-order",
        "archive",
        "update-status",
        "notes",
        "slack",
        "erp",
        "crm",
        "sms",
        "ai-agent",
        "delay",
        "condition",
      ].sort()
    );
  });

  it("returns null (never throws) for an unregistered module name", () => {
    expect(getAutomationModule("does-not-exist")).toBeNull();
  });

  it.each(AVAILABLE_MODULES)("%s conforms to the AutomationModule interface", (name) => {
    const module = getAutomationModule(name);
    expect(module).not.toBeNull();
    expect(typeof module!.run).toBe("function");
    if (module!.shouldRun !== undefined) {
      expect(typeof module!.shouldRun).toBe("function");
    }
    if (module!.validateConfig !== undefined) {
      expect(typeof module!.validateConfig).toBe("function");
    }
  });

  it.each(AVAILABLE_MODULES)("%s's validateConfig (if present) returns null or a string, never throws", (name) => {
    const module = getAutomationModule(name)!;
    if (!module.validateConfig) return;

    const result = module.validateConfig({});
    expect(result === null || typeof result === "string").toBe(true);
  });
});
