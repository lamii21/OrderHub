import type { AutomationModule } from "./types";

// Stub: no SMS provider is connected to this deployment yet.
type SmsConfig = { template: string };

export const smsModule: AutomationModule = {
  validateConfig(config) {
    const { template } = config as Partial<SmsConfig>;

    if (typeof template !== "string" || template.trim() === "") {
      return "SMS requires a non-empty message template.";
    }

    return null;
  },

  async run(order) {
    if (!order.customer_phone) {
      return { success: false, message: "Order has no customer phone number." };
    }

    return {
      success: false,
      message: "SMS is not implemented yet — this step is a stub.",
    };
  },
};
