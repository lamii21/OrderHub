import type { EventType } from "@/lib/events/types";
import type { WorkflowContext } from "@/lib/automation-modules/types";

export type WorkflowStep = {
  id: number;
  workflow_id: number;
  step_order: number;
  module_name: string;
  config: Record<string, unknown>;
};

export type WorkflowWithSteps = {
  id: number;
  shop_id: number;
  name: string;
  trigger_event: EventType;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
  steps: WorkflowStep[];
};

export type WorkflowExecution = {
  id: number;
  workflow_id: number;
  order_id: number;
  step_order: number;
  module_name: string;
  status: "success" | "failed";
  message: string | null;
  duration_ms: number;
  started_at: string;
};

// Same "base row + joined shape" split as types/sync-history.ts's
// SyncHistoryEntry/SyncHistoryWithShop — backs lib/workflows/execution-history.ts's
// reads (app/orders/[id]/page.tsx's Automation section joins the same way).
export type WorkflowExecutionWithWorkflow = WorkflowExecution & {
  workflows: { name: string } | null;
};

// One pending pause, backing lib/workflows/resume.ts — see
// supabase/schema.sql's workflow_waits table comment for why this is a
// dedicated table rather than columns on WorkflowExecution.
export type WorkflowWait = {
  id: number;
  workflow_id: number;
  order_id: number;
  // A stable workflow_steps.id, not a step_order snapshot — null when the
  // target step has since been deleted (on delete set null). See
  // supabase/schema.sql's own column comment for why step_order can't be
  // trusted here.
  resume_step_id: number | null;
  context: WorkflowContext;
  resume_at: string;
  created_at: string;
  consumed_at: string | null;
};

// Backs get_workflows_with_stats() — the /admin "Workflow Statistics"
// table, mirroring ShopWithStats' role for get_shops_with_stats().
export type WorkflowWithStats = {
  id: number;
  shop_id: number;
  shop_name: string | null;
  name: string;
  trigger_event: EventType;
  is_active: boolean;
  step_count: number;
  execution_count: number;
  success_count: number;
  failure_count: number;
  avg_duration_ms: number | null;
  last_execution_at: string | null;
  last_execution_status: "success" | "failed" | null;
  created_at: string;
};
