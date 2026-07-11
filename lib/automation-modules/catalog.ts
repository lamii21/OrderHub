import { ORDER_STATUSES } from "@/lib/validation";

// UI-only metadata for the Workflow Builder's Module Palette and
// Properties Panel (see the UI specification, §5/§6) — deliberately
// separate from AutomationModule/validateConfig in ./types.ts and each
// module's own file. Those answer "is this config valid"; this answers
// "how does a merchant pick and understand this module." A module that
// exists but has no entry here would still run fine — it just can't be
// added from the Palette (see the "no drift" test in
// tests/modules/catalog.test.ts, which keeps this list from silently
// falling behind AVAILABLE_MODULES).
export type ModuleCategory = "action" | "control";

export type ModuleCatalogEntry = {
  name: string;
  icon: string;
  category: ModuleCategory;
  // One line, shown on the palette card — what the step does, not how.
  purpose: string;
  // One line, shown above the Properties Panel's config field — the
  // config's expected shape in prose, not a generated form (a deliberate
  // KISS decision: see the UI specification, §6).
  configHint: string;
};

export const MODULE_CATALOG: Record<string, ModuleCatalogEntry> = {
  whatsapp: {
    name: "WhatsApp",
    icon: "💬",
    category: "action",
    purpose: "Send a WhatsApp message to the customer",
    configHint: 'template (message text, supports {{customer_name}}, {{product}}, ...)',
  },
  delivery: {
    name: "Delivery",
    icon: "📦",
    category: "action",
    purpose: "Create a shipment with a delivery carrier",
    configHint: 'carrier (currently: "generic-webhook")',
  },
  email: {
    name: "Email",
    icon: "✉️",
    category: "action",
    purpose: "Send a transactional email to the customer",
    configHint: "subject (text), body (text, supports {{customer_name}}, {{product}}, ...)",
  },
  "google-sheets": {
    name: "Google Sheets",
    icon: "📊",
    category: "action",
    purpose: "Append the order to a Google Sheet",
    configHint: "spreadsheetId (text), sheetName (text)",
  },
  webhook: {
    name: "Webhook",
    icon: "🔗",
    category: "action",
    purpose: "POST the order to any URL",
    configHint: "url (https:// or http://), method (optional: POST/PUT/PATCH), headers (optional)",
  },
  slack: {
    name: "Slack",
    icon: "📣",
    category: "action",
    purpose: "Post a message to a Slack channel",
    configHint: "webhookUrl (https:// Slack incoming webhook), template (optional message text)",
  },
  sms: {
    name: "SMS",
    icon: "📱",
    category: "action",
    purpose: "Send an SMS to the customer",
    configHint: 'template (message text, supports {{customer_name}}, {{product}}, ...)',
  },
  erp: {
    name: "ERP",
    icon: "🗄️",
    category: "action",
    purpose: "Push the order to an ERP endpoint",
    configHint: "endpoint (https:// or http:// URL)",
  },
  crm: {
    name: "CRM",
    icon: "📇",
    category: "action",
    purpose: "Push the order to a CRM endpoint",
    configHint: "provider (label, e.g. \"hubspot\"), endpoint (https:// or http:// URL)",
  },
  "tag-order": {
    name: "Tag Order",
    icon: "🏷️",
    category: "action",
    purpose: "Add tags to the order",
    configHint: 'tags (array of non-empty strings, e.g. ["vip", "priority"])',
  },
  archive: {
    name: "Archive",
    icon: "📁",
    category: "action",
    purpose: "Archive the order",
    configHint: "No configuration needed.",
  },
  "update-status": {
    name: "Update Status",
    icon: "🔄",
    category: "action",
    purpose: "Change the order's status",
    configHint: `status (one of: ${ORDER_STATUSES.join(", ")})`,
  },
  notes: {
    name: "Notes",
    icon: "📝",
    category: "action",
    purpose: "Add an internal note to the order",
    configHint: 'content (note text, supports {{customer_name}}, {{product}}, ...)',
  },
  "ai-agent": {
    name: "AI Agent",
    icon: "🤖",
    category: "action",
    purpose: "Ask an AI model to classify or decide something about the order",
    configHint: "task (instruction text), confidenceThreshold (optional number, 0 to 1)",
  },
  delay: {
    name: "Delay",
    icon: "⏱️",
    category: "control",
    purpose: "Pause the workflow for a set duration",
    configHint: 'duration (e.g. "30m", "2h", "1d")',
  },
  condition: {
    name: "Condition",
    icon: "🔀",
    category: "control",
    purpose: "Stop the workflow unless a condition is met",
    configHint: "field (price, quantity, status, customer_city, platform), operator (>, <, >=, <=, ==, !=), value",
  },
};

const FALLBACK_ENTRY: ModuleCatalogEntry = {
  name: "Unknown module",
  icon: "❓",
  category: "action",
  purpose: "This module is not available.",
  configHint: "This module is not registered — its configuration can no longer be validated.",
};

// Never throws — a step can reference a module_name that used to be
// registered and no longer is (see engine.ts's own handling of that same
// case); the Properties Panel still needs something to render for it.
export function getModuleCatalogEntry(moduleName: string): ModuleCatalogEntry {
  return MODULE_CATALOG[moduleName] ?? FALLBACK_ENTRY;
}

// A short, human-readable read of a step's config for the flow view's step
// cards (UI specification §3: "résumé lisible de sa configuration").
// Deliberately not a generic JSON dump — picks the one field a merchant
// would actually recognize per module, falling back to the first common
// field name found for any module not special-cased here.
export function summarizeStepConfig(moduleName: string, config: Record<string, unknown>): string {
  switch (moduleName) {
    case "tag-order": {
      const tags = config.tags;
      return Array.isArray(tags) && tags.length > 0
        ? `Add tags: ${tags.filter((t) => typeof t === "string").join(", ")}`
        : "No tags configured yet.";
    }
    case "update-status": {
      const status = config.status;
      return typeof status === "string" && status
        ? `Set status to "${status}"`
        : "No target status configured yet.";
    }
    case "condition": {
      const { field, operator, value } = config as { field?: unknown; operator?: unknown; value?: unknown };
      return typeof field === "string" && typeof operator === "string" && value !== undefined && value !== ""
        ? `${field} ${operator} ${String(value)}`
        : "No condition configured yet.";
    }
    case "delay": {
      const duration = config.duration;
      return typeof duration === "string" && duration ? `Wait ${duration}` : "No duration configured yet.";
    }
    case "archive":
      return "No configuration needed.";
    default: {
      const fields = ["task", "subject", "template", "content", "provider", "webhookUrl", "url", "endpoint", "spreadsheetId"];
      for (const field of fields) {
        const value = config[field];
        if (typeof value === "string" && value.trim() !== "") {
          return value.trim();
        }
      }
      return "No configuration set yet.";
    }
  }
}

// Consumed by tests/modules/catalog.test.ts, which asserts this list never
// drifts out of sync with AVAILABLE_MODULES — same "no drift" reasoning as
// index.ts's own loader test, applied to this UI-only catalog instead.
export const MODULE_CATALOG_NAMES = Object.keys(MODULE_CATALOG);
