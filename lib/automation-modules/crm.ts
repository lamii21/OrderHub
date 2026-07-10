import type { AutomationModule } from "./types";

// Stub: no CRM provider is connected to this deployment yet. `provider`
// mirrors the sub-registry shape Delivery already uses for real — kept
// here as a single required field so a future implementation can add
// providers without changing this config's shape.
type CrmConfig = { provider: string };

export const crmModule: AutomationModule = {
  validateConfig(config) {
    const { provider } = config as Partial<CrmConfig>;

    if (typeof provider !== "string" || provider.trim() === "") {
      return "CRM requires a provider name.";
    }

    return null;
  },

  async run() {
    return {
      success: false,
      message: "CRM is not implemented yet — this step is a stub.",
    };
  },
};
