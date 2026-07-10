import type { AutomationModule } from "./types";

// Stub: no ERP endpoint is connected to this deployment yet.
type ErpConfig = { endpoint: string };

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export const erpModule: AutomationModule = {
  validateConfig(config) {
    const { endpoint } = config as Partial<ErpConfig>;

    if (typeof endpoint !== "string" || !isValidUrl(endpoint)) {
      return "ERP requires a valid endpoint URL.";
    }

    return null;
  },

  async run() {
    return {
      success: false,
      message: "ERP is not implemented yet — this step is a stub.",
    };
  },
};
