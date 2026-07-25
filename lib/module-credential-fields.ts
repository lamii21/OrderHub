// Which fields each automation module's module_credentials row expects —
// must match what each module's own file reads: lib/automation-modules/
// whatsapp.ts, sms.ts, email.ts, delivery.ts, crm.ts, erp.ts, ai-agent.ts.
// Slack and the generic Webhook module are deliberately absent here: both
// take their config (webhook URL, template...) per workflow step, not
// per-shop credentials — there is nothing for this page to configure for
// them.
//
// A plain data file, not part of app/shops/[id]/integrations/actions.ts:
// a "use server" file may only export async functions, and both the
// Server Action and the page need this same shape.
export type CredentialField = {
  name: string;
  label: string;
  required: boolean;
  type: "text" | "password";
};

export const CREDENTIAL_MODULES = {
  whatsapp: {
    label: "WhatsApp",
    description: "Meta WhatsApp Cloud API — sends order messages as the connected business number.",
    fields: [
      { name: "accessToken", label: "Access Token", required: true, type: "password" },
      { name: "phoneNumberId", label: "Phone Number ID", required: true, type: "text" },
    ],
  },
  sms: {
    label: "SMS",
    description: "Twilio — sends order messages as text.",
    fields: [
      { name: "accountSid", label: "Account SID", required: true, type: "text" },
      { name: "authToken", label: "Auth Token", required: true, type: "password" },
      { name: "fromNumber", label: "From Number", required: true, type: "text" },
    ],
  },
  email: {
    label: "Email",
    description: "Resend — sends transactional emails to the customer's address.",
    fields: [
      { name: "apiKey", label: "API Key", required: true, type: "password" },
      { name: "fromAddress", label: "From Address", required: true, type: "text" },
    ],
  },
  delivery: {
    label: "Delivery",
    description: "Posts order details to a carrier webhook and reads back a tracking number.",
    fields: [
      { name: "webhookUrl", label: "Webhook URL", required: true, type: "text" },
      { name: "apiKey", label: "API Key (optional)", required: false, type: "password" },
    ],
  },
  crm: {
    label: "CRM",
    description: "Posts order details to a CRM endpoint set per workflow step.",
    fields: [{ name: "apiKey", label: "API Key (optional)", required: false, type: "password" }],
  },
  erp: {
    label: "ERP",
    description: "Posts order details to an ERP endpoint set per workflow step.",
    fields: [{ name: "apiKey", label: "API Key (optional)", required: false, type: "password" }],
  },
  "ai-agent": {
    label: "AI Agent",
    description: "Anthropic Claude — runs a configured prompt against the order.",
    fields: [
      { name: "apiKey", label: "Anthropic API Key", required: true, type: "password" },
      { name: "model", label: "Model", required: true, type: "text" },
    ],
  },
} as const satisfies Record<string, { label: string; description: string; fields: readonly CredentialField[] }>;

export type CredentialModuleName = keyof typeof CREDENTIAL_MODULES;

export const CREDENTIAL_MODULE_NAMES = Object.keys(CREDENTIAL_MODULES) as CredentialModuleName[];

export function isCredentialModuleName(value: string): value is CredentialModuleName {
  return (CREDENTIAL_MODULE_NAMES as string[]).includes(value);
}
