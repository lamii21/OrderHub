import type { AutomationModule } from "./types";
import { whatsappModule } from "./whatsapp";
import { deliveryModule } from "./delivery";
import { emailModule } from "./email";
import { googleSheetsModule } from "./google-sheets";
import { webhookModule } from "./webhook";
import { tagOrderModule } from "./tag-order";
import { archiveModule } from "./archive";
import { updateStatusModule } from "./update-status";
import { notesModule } from "./notes";
import { slackModule } from "./slack";
import { erpModule } from "./erp";
import { crmModule } from "./crm";
import { smsModule } from "./sms";
import { aiAgentModule } from "./ai-agent";
import { delayModule } from "./delay";
import { conditionModule } from "./condition";

// The one and only place a module name maps to actual code — same registry
// pattern as lib/platforms/index.ts's getConnector()/SUPPORTED_PLATFORMS.
// Adding a 17th module tomorrow is one file + one line here — nothing in
// the Execution Engine changes.
//
// Every one of the 16 modules is real: each validates its config and
// returns a genuine structured result. Delay/Condition specifically return
// the "waiting"/"stop" outcomes the Execution Engine supports (see
// ModuleResult.outcome) rather than calling out to any external provider.
//
// Unlike getConnector() (which throws when a platform is unregistered — a
// hard misconfiguration sync can't proceed without), a missing automation
// module is expected and recoverable: it just means that one step has
// nothing to run yet. Returning null instead of throwing lets
// lib/workflows/engine.ts record it as a failed step and continue with the
// rest of the workflow, consistent with "one failed step never stops the
// others."
const modules: Record<string, AutomationModule> = {
  whatsapp: whatsappModule,
  delivery: deliveryModule,
  email: emailModule,
  "google-sheets": googleSheetsModule,
  webhook: webhookModule,
  "tag-order": tagOrderModule,
  archive: archiveModule,
  "update-status": updateStatusModule,
  notes: notesModule,
  slack: slackModule,
  erp: erpModule,
  crm: crmModule,
  sms: smsModule,
  "ai-agent": aiAgentModule,
  delay: delayModule,
  condition: conditionModule,
};

export function getAutomationModule(moduleName: string): AutomationModule | null {
  return modules[moduleName] ?? null;
}

// Single source of truth for which modules the Workflow Builder is allowed
// to offer in a step's module dropdown — same role as SUPPORTED_PLATFORMS
// for the Connect Store form.
export const AVAILABLE_MODULES = Object.keys(modules);

// ==== Dynamic loading ====
// getAutomationModule() above resolves a module name via a plain object
// lookup, but every one of the 16 module files is still imported eagerly
// at the top of this one — the whole registry (and every module's own
// dependencies, e.g. googleapis for the Google Sheets module) loads
// whenever anything imports lib/automation-modules, even a caller that
// only ever needs one module. loadAutomationModule() below is a second,
// additive way to resolve the same names: it only ever imports the one
// file a given call actually asks for, via a real import(), so an
// unused module's code and dependencies are never pulled in for a run
// that doesn't touch it. Nothing existing is switched over to this —
// lib/workflows/engine.ts and the Workflow Builder's Server Actions keep
// calling the synchronous getAutomationModule() exactly as before; this
// exists as the lazy-loading option for a future caller (or a future
// migration of the engine itself) to adopt deliberately, not a change to
// what already works today.
type ModuleLoader = () => Promise<AutomationModule>;

// One loader per entry in AVAILABLE_MODULES — see this file's own test for
// the check that keeps the two lists from silently drifting apart as
// modules are added. Each loader's .then() picks out that module's own
// named export (every module file exports its implementation as
// `<name>Module`, never a default export), which is the one piece dynamic
// import() can't infer generically from the module name alone.
const moduleLoaders: Record<string, ModuleLoader> = {
  whatsapp: () => import("./whatsapp").then((m) => m.whatsappModule),
  delivery: () => import("./delivery").then((m) => m.deliveryModule),
  email: () => import("./email").then((m) => m.emailModule),
  "google-sheets": () => import("./google-sheets").then((m) => m.googleSheetsModule),
  webhook: () => import("./webhook").then((m) => m.webhookModule),
  "tag-order": () => import("./tag-order").then((m) => m.tagOrderModule),
  archive: () => import("./archive").then((m) => m.archiveModule),
  "update-status": () => import("./update-status").then((m) => m.updateStatusModule),
  notes: () => import("./notes").then((m) => m.notesModule),
  slack: () => import("./slack").then((m) => m.slackModule),
  erp: () => import("./erp").then((m) => m.erpModule),
  crm: () => import("./crm").then((m) => m.crmModule),
  sms: () => import("./sms").then((m) => m.smsModule),
  "ai-agent": () => import("./ai-agent").then((m) => m.aiAgentModule),
  delay: () => import("./delay").then((m) => m.delayModule),
  condition: () => import("./condition").then((m) => m.conditionModule),
};

// Resolved modules are cached in memory after their first load — the JS
// engine's own module registry already avoids re-evaluating the same
// import() target twice, but caching the resolved value here also skips
// the repeat microtask hop of awaiting an already-settled dynamic import
// on every subsequent call for the same module.
const loadedModules = new Map<string, AutomationModule>();

// Same null-when-unregistered contract as getAutomationModule() — a
// missing module is expected and recoverable (see that function's own
// comment), never thrown.
export async function loadAutomationModule(moduleName: string): Promise<AutomationModule | null> {
  const cached = loadedModules.get(moduleName);
  if (cached) {
    return cached;
  }

  const loader = moduleLoaders[moduleName];
  if (!loader) {
    return null;
  }

  const moduleImpl = await loader();
  loadedModules.set(moduleName, moduleImpl);
  return moduleImpl;
}

// Test-only escape hatch — the module-scope Map otherwise carries a
// loaded module across test cases that mock a different implementation
// under the same name.
export function __resetLoadedModulesCache() {
  loadedModules.clear();
}

export type { AutomationModule, ModuleResult, ModuleOutcome, WorkflowContext } from "./types";
