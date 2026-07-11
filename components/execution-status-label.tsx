import type { WorkflowExecution } from "@/types/workflow";

// A "stop"/"waiting" outcome (lib/workflows/engine.ts) is recorded as a
// successful step — it's a deliberate exit, not a bug — but showing it as
// a plain green "Success" would hide that distinction from the merchant.
// Shown in amber instead: a voluntary system stop is never presented as
// either a failure (red) or an ordinary success (green) (Workflow Builder
// UI specification, §7/Errors). Detected off the message engine.ts already
// writes, since status alone can't tell the two apart. Shared by every
// execution-history table (the Workflow Editor, the Shop page's Automation
// Activity, ...) so the distinction reads identically everywhere it shows up.
export function describeExecutionStatus(
  entry: Pick<WorkflowExecution, "status" | "message">
): { label: string; className: string } {
  if (entry.status === "success" && entry.message?.startsWith("Workflow stopped:")) {
    return { label: "Stopped", className: "text-amber-700" };
  }
  if (entry.status === "success" && entry.message?.startsWith("Workflow paused")) {
    return { label: "Paused", className: "text-amber-700" };
  }
  return entry.status === "success"
    ? { label: "Success", className: "text-green-700" }
    : { label: "Failed", className: "text-red-700" };
}

export function ExecutionStatusLabel({
  entry,
}: {
  entry: Pick<WorkflowExecution, "status" | "message">;
}) {
  const { label, className } = describeExecutionStatus(entry);
  return <span className={className}>{label}</span>;
}
