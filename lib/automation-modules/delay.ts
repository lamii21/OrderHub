import type { AutomationModule } from "./types";

// Control module. Reports a "waiting" outcome — the Execution Engine
// vocabulary extension this module was blocked on has since landed (see
// ModuleResult.outcome in ./types.ts): runWorkflow() now halts the rest of
// this workflow run and records the step as a successful pause rather than
// a failure. True suspend/resume (a persisted "waiting" state plus a cron
// sweep that re-enters the workflow at the next step once the duration
// elapses) is still a separate, not-yet-built piece — the engine's own
// comment is explicit that "waiting" is currently treated the same as
// "stop" for this run. This module's job stops at requesting the pause and
// saying so honestly; it has no business reaching into the engine itself.
type DelayConfig = { duration: string };

const DURATION_PATTERN = /^(\d+)(m|h|d)$/;

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseDurationMs(duration: string): number | null {
  const match = DURATION_PATTERN.exec(duration);
  if (!match) {
    return null;
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}

export const delayModule: AutomationModule = {
  validateConfig(config) {
    const { duration } = config as Partial<DelayConfig>;

    if (typeof duration !== "string" || !DURATION_PATTERN.test(duration)) {
      return 'Delay requires a simple duration like "30m", "2h", or "1d".';
    }

    return null;
  },

  async run(order, config) {
    const { duration } = config as DelayConfig;
    const durationMs = parseDurationMs(duration);

    // Defensive re-check, same reasoning as update-status.ts/tag-order.ts:
    // a saved step's config can only be trusted as far as validateConfig()
    // was actually run against it.
    if (durationMs === null) {
      return { success: false, message: `Invalid delay duration "${duration}".` };
    }

    return {
      success: true,
      outcome: "waiting",
      message: `Delay requested (${duration}) — resume is not yet implemented, so the workflow halts here for this run.`,
      data: { duration, durationMs },
    };
  },
};
