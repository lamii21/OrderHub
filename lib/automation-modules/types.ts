import type { Order } from "@/types/order";

// Keyed by module_name, populated by the Execution Engine after every
// successful step from that step's ModuleResult.data — this is how, e.g.,
// an AI Agent step's classification becomes readable by a later Tag Order
// or Condition step in the same run. A plain object, not a class: modules
// only ever read it, only the engine ever writes to it.
export type WorkflowContext = Record<string, Record<string, unknown>>;

// What every module's run() returns instead of void — the Execution Engine
// turns this directly into the workflow_executions row (status + message),
// and folds `data` into the context for later steps. Modules never touch
// workflow_executions or the context object themselves; they only ever
// return this value and let the engine decide what to do with it.
export type ModuleResult = {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
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
