// One row per (shop, module) pair — lib/automation-modules/credentials.ts's
// getModuleCredentials() is the only reader. `credentials` is opaque JSON:
// its shape is entirely defined by whichever module reads it (see that
// module's own credentials type, e.g. whatsapp.ts's WhatsAppCredentials),
// never interpreted here.
export type ModuleCredentials = {
  id: number;
  shop_id: number;
  module_name: string;
  credentials: Record<string, unknown>;
  created_at: string;
};
