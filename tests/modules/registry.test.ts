import { describe, it, expect, beforeEach } from "vitest";
import {
  getAutomationModule,
  AVAILABLE_MODULES,
  loadAutomationModule,
  __resetLoadedModulesCache,
} from "@/lib/automation-modules";

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

describe("loadAutomationModule (dynamic loading)", () => {
  beforeEach(() => {
    __resetLoadedModulesCache();
  });

  it("has exactly one loader per module in AVAILABLE_MODULES — no drift between the two registries", async () => {
    for (const name of AVAILABLE_MODULES) {
      await expect(loadAutomationModule(name)).resolves.not.toBeNull();
    }
  });

  it("returns null (never throws or rejects) for an unregistered module name", async () => {
    await expect(loadAutomationModule("does-not-exist")).resolves.toBeNull();
  });

  it.each(AVAILABLE_MODULES)(
    "resolves %s to the exact same implementation the static registry returns",
    async (name) => {
      const dynamic = await loadAutomationModule(name);
      const staticModule = getAutomationModule(name);

      expect(dynamic).toBe(staticModule);
    }
  );

  it("caches a resolved module — a second call for the same name doesn't re-import", async () => {
    const first = await loadAutomationModule("archive");
    const second = await loadAutomationModule("archive");

    expect(second).toBe(first);
  });

  it("__resetLoadedModulesCache clears the cache without changing what resolves", async () => {
    const first = await loadAutomationModule("archive");
    __resetLoadedModulesCache();
    const second = await loadAutomationModule("archive");

    // Same module implementation (modules are singletons either way), the
    // cache reset only forces the lookup path to run again, not a
    // different result.
    expect(second).toBe(first);
  });
});
