import type { AutomationModule } from "./types";

// Stub: no Slack workspace/webhook is connected to this deployment yet.
// Config validation is real (so a merchant can build a workflow using this
// step today); run() honestly reports it isn't wired up rather than
// pretending to notify a channel that doesn't exist.
type SlackConfig = { webhookUrl: string; template?: string };

function isValidHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export const slackModule: AutomationModule = {
  validateConfig(config) {
    const { webhookUrl } = config as Partial<SlackConfig>;

    if (typeof webhookUrl !== "string" || !isValidHttpsUrl(webhookUrl)) {
      return "Slack requires a valid https webhook URL.";
    }

    return null;
  },

  async run() {
    return {
      success: false,
      message: "Slack is not implemented yet — this step is a stub.",
    };
  },
};
