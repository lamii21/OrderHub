import type { AutomationModule } from "./types";

// Control module, stub. Delay's real behavior (see the Automation Modules
// catalog) needs run() to be able to return an outcome beyond
// success/failed — a "waiting" state with a resumeAt timestamp — plus an
// Execution Engine capable of suspending a workflow_executions row and a
// cron sweep to resume it later. None of that exists yet: extending the
// result vocabulary is explicitly called out in the catalog as a decision
// to make deliberately, not casually, so it's a separate task from
// registering this module. Config validation is real; run() honestly
// reports the gap instead of silently doing nothing.
type DelayConfig = { duration: string };

const DURATION_PATTERN = /^\d+(m|h|d)$/;

export const delayModule: AutomationModule = {
  validateConfig(config) {
    const { duration } = config as Partial<DelayConfig>;

    if (typeof duration !== "string" || !DURATION_PATTERN.test(duration)) {
      return 'Delay requires a simple duration like "30m", "2h", or "1d".';
    }

    return null;
  },

  async run() {
    return {
      success: false,
      message:
        "Delay is not implemented yet — it requires an Execution Engine outcome extension (a \"waiting\" state) not built in this phase.",
    };
  },
};
