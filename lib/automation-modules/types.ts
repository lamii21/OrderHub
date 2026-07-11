import type { Order } from "@/types/order";

// Keyed by module_name, populated by the Execution Engine after every
// successful step from that step's ModuleResult.data — this is how, e.g.,
// an AI Agent step's classification becomes readable by a later Tag Order
// or Condition step in the same run. A plain object, not a class: modules
// only ever read it, only the engine ever writes to it.
export type WorkflowContext = Record<string, Record<string, unknown>>;

// The Execution Engine's control-flow vocabulary, beyond plain
// success/failed — see ModuleResult.outcome below for what each value
// actually does. Every module shipped today omits this field entirely and
// keeps behaving exactly as before; it exists for Delay/Condition (and any
// future module) to opt into.
export type ModuleOutcome = "success" | "failed" | "stop" | "waiting" | "retry";

// What every module's run() returns instead of void — the Execution Engine
// turns this directly into the workflow_executions row (status + message),
// and folds `data` into the context for later steps. Modules never touch
// workflow_executions or the context object themselves; they only ever
// return this value and let the engine decide what to do with it.
export type ModuleResult = {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  // Optional, richer signal layered on top of `success` — omit it (as
  // every currently-shipped module does) and the engine branches on
  // `success` alone, exactly as before this field existed. When present,
  // it takes priority over `success` for deciding what the engine does
  // next:
  //   "stop"    — a deliberate early exit (e.g. Condition evaluating
  //               false), not an error. Halts the rest of this workflow
  //               run; recorded as a successful step.
  //   "waiting" — the module wants to pause and resume later (e.g.
  //               Delay). True suspend/resume — a persisted "waiting"
  //               state and a cron sweep to pick it back up — isn't built
  //               yet (a deliberate, separate decision per the Automation
  //               Modules catalog); the engine currently treats this the
  //               same as "stop" for this run, rather than silently
  //               continuing past a step that asked to wait.
  //   "retry"   — the module wants this step retried. No automatic retry
  //               exists yet; the engine records the attempt as failed
  //               and moves on to the next step, same as any other
  //               failure, until a real retry mechanism is built. This is
  //               the hook a future retry mechanism attaches to, not
  //               retry logic itself.
  outcome?: ModuleOutcome;
};

// The contract every automation module implements — deliberately 2 required
// methods, mirroring lib/platforms/types.ts's PlatformConnector (interface +
// registry, the same proven pattern applied to a second, unrelated concern).
// A module never knows which workflow called it, its position in the
// sequence, or that the other steps even exist — it only ever sees the
// order, its own step's config, and the shared inter-step context.
export interface AutomationModule {
  // Optional escape hatch to skip this step for a specific order without
  // that counting as a failure (e.g. a WhatsApp module with no phone number
  // on file). Defaults to always running when omitted.
  shouldRun?(
    order: Order,
    config: Record<string, unknown>,
    context: WorkflowContext
  ): boolean | Promise<boolean>;

  run(
    order: Order,
    config: Record<string, unknown>,
    context: WorkflowContext
  ): Promise<ModuleResult>;

  // Called by the Workflow Builder when a merchant saves a step's config
  // (see the Workflow Builder specification §7) — "the semantics of what
  // counts as valid config stays the module's own responsibility, never the
  // Builder's." Returns a human-readable reason when invalid, or null when
  // the config is acceptable.
  validateConfig?(config: Record<string, unknown>): string | null;
}
