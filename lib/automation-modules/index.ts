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
// WhatsApp/Delivery/Email/Google Sheets/Webhook/Tag Order/Archive/Update
// Status/Notes are real: they validate config, call out (or write) for
// real, and return a genuine structured result. Slack/ERP/CRM/SMS/AI
// Agent/Delay/Condition are stubs — either no external API is connected to
// this deployment yet, or (Delay/Condition) the Execution Engine doesn't
// yet support the outcome vocabulary ("waiting"/"stop") their real
// behavior needs. Every stub still validates its config for real; only
// run() is a placeholder.
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

export type { AutomationModule, ModuleResult, WorkflowContext } from "./types";
