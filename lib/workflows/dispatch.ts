import { resolveWorkflows } from "./manager";
import { runWorkflow } from "./engine";
import { logger } from "@/lib/logger";
import type { EventType } from "@/lib/events/types";
import type { Order } from "@/types/order";

// Defense-in-depth, not a fix for anything reachable today: no automation
// module currently calls back into handleEvent() (see
// automation-modules/update-status.ts's own comment on why it deliberately
// stops short of re-dispatching order.status_changed after changing an
// order's status — this guard is exactly what that comment was waiting on).
// If a future module ever does trigger a new event from inside a running
// workflow, this stops workflow A -> workflow B -> workflow A from
// recursing indefinitely and spamming a merchant's WhatsApp/webhook, rather
// than relying on every such module getting its own guard right.
const MAX_DISPATCH_DEPTH = 3;

// The bridge between Events and the rest of the Workflow Engine — called
// directly from the Webhook (order.created) and from updateOrderStatus()
// (order.status_changed / order.cancelled), exactly as designed in the
// Workflow Engine dossier's order-lifecycle walkthrough. Chains Workflow
// Manager (resolve) -> Execution Engine (run) for every matching workflow,
// one at a time; workflows run independently, so one workflow's failure
// can never stop another's (runWorkflow() already isolates failures at the
// step level the same way).
//
// Deliberately does not swallow anything beyond what runWorkflow() already
// handles internally — callers (the webhook, updateOrderStatus) still wrap
// their own call to handleEvent() in a try/catch, so a genuinely unexpected
// error here can never fail the order write or status update itself.
// Automation is a downstream, best-effort consumer of order data, never a
// precondition for it being saved correctly.
export async function handleEvent(
  shopId: number,
  eventType: EventType,
  order: Order,
  depth = 0
): Promise<void> {
  if (depth >= MAX_DISPATCH_DEPTH) {
    logger.warn("workflow.dispatch_depth_exceeded", { shopId, eventType, orderId: order.id, depth });
    return;
  }

  const workflows = await resolveWorkflows(shopId, eventType);

  for (const workflow of workflows) {
    await runWorkflow(workflow, order);
  }
}
