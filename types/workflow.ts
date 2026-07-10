import type { EventType } from "@/lib/events/types";

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
  last_execution_at: string | null;
  last_execution_status: "success" | "failed" | null;
  created_at: string;
};
