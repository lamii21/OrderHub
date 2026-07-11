import { supabase } from "@/lib/supabase";
import { isValidEventType, type EventType } from "@/lib/events/types";
import type { WorkflowStep, WorkflowWithSteps } from "@/types/workflow";

// Per-instance, short-TTL cache — same pattern and trade-off as
// lib/automation-modules/credentials.ts's getModuleCredentials(): a busy
// shop can trigger resolveWorkflows() many times in quick succession (one
// call per order.created/order.status_changed/order.cancelled dispatch),
// while a shop's own workflow definitions change far less often than that.
// Not shared across serverless instances, deliberately not backed by Redis
// (this project's standing "no new infrastructure" rule) — a workflow
// activated/edited on /shops/[id]/workflows can take up to CACHE_TTL_MS to
// be picked up by the next dispatch on an already-warm instance, an
// acceptable trade for cutting repeat DB round trips on the hot webhook
// path. Shorter than credentials.ts's 60s: activating a workflow is a more
// directly user-facing action (a merchant expects it to apply to the very
// next order) than rotating a credential.
const CACHE_TTL_MS = 30_000;

type CacheEntry = { value: WorkflowWithSteps[]; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function cacheKey(shopId: number, eventType: EventType): string {
  return `${shopId}:${eventType}`;
}

// Pure read: given (shop_id, event_type), return every active workflow
// that should react, with its steps already loaded and ordered. Zero side
// effects, zero external calls, and — deliberately — zero execution: this
// is the recipe, never the cooking (lib/workflows/engine.ts's
// runWorkflow() is the only thing that ever calls a module). No
// interface: only one implementation will ever exist, so one would be a
// gratuitous abstraction (see the Workflow Engine dossier's own reasoning
// for this layer).
//
// Runs on the service-role client, same as lib/sync.ts throughout: this is
// a system-level read triggered by a webhook or a status-change dispatch,
// never a user-scoped page load, so there's no user session to run it as.
// RLS still fully protects this data for any future user-facing read (e.g.
// a Workflow Builder page reading its own workflows as the logged-in
// user).
export async function resolveWorkflows(
  shopId: number,
  eventType: EventType
): Promise<WorkflowWithSteps[]> {
  // Defensive, not redundant with TypeScript: this is a boundary function
  // (called from dispatch.handleEvent(), itself reachable from the
  // webhook and from Server Actions), so a caller passing a corrupted
  // value due to a future bug gets a clean, logged empty result instead of
  // a malformed query silently returning nothing or erroring deep inside
  // PostgREST.
  if (!Number.isInteger(shopId) || shopId <= 0) {
    console.error(`resolveWorkflows: invalid shopId "${shopId}"`);
    return [];
  }

  if (!isValidEventType(eventType)) {
    console.error(`resolveWorkflows: invalid eventType "${eventType}"`);
    return [];
  }

  const key = cacheKey(shopId, eventType);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { data, error } = await supabase
    .from("workflows")
    .select("*, workflow_steps(*)")
    .eq("shop_id", shopId)
    .eq("trigger_event", eventType)
    .eq("is_active", true);

  if (error) {
    console.error("resolveWorkflows failed:", error);
    return [];
  }

  const workflows = (data ?? [])
    .map((workflow) => {
      const { workflow_steps, ...rest } = workflow as WorkflowWithSteps & {
        workflow_steps: WorkflowStep[];
      };

      return {
        ...rest,
        steps: [...workflow_steps].sort((a, b) => a.step_order - b.step_order),
      };
    })
    // A workflow with no steps has nothing to run — filtering it out here,
    // once, means every caller (dispatch.handleEvent, "Test Workflow
    // Now") gets back only actionable workflows, instead of each needing
    // its own "skip if steps.length === 0" check. Observably identical to
    // returning it anyway: runWorkflow()'s loop over zero steps already
    // does nothing and writes no execution rows, so this only removes a
    // wasted call, not a wasted outcome.
    .filter((workflow) => workflow.steps.length > 0);

  cache.set(key, { value: workflows, expiresAt: Date.now() + CACHE_TTL_MS });

  return workflows;
}

// Test-only escape hatch, and useful for a future "workflow saved"/
// "workflow activated" Server Action wanting to invalidate immediately
// instead of waiting out the TTL — same shape as
// lib/automation-modules/credentials.ts's invalidateModuleCredentialsCache().
export function invalidateWorkflowCache(shopId?: number, eventType?: EventType) {
  if (shopId === undefined) {
    cache.clear();
    return;
  }

  if (eventType === undefined) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${shopId}:`)) cache.delete(key);
    }
    return;
  }

  cache.delete(cacheKey(shopId, eventType));
}
