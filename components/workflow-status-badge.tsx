// Same shape as ShopHealthBadge/SystemHealthBadge (emoji + label span) —
// applied to a single order's automation outcome instead of a shop or a
// system component. "none" covers both "no workflow has ever run for this
// order" and "no workflows exist yet" — the viewer doesn't need to
// distinguish those here.
export type OrderAutomationStatus = "success" | "failed" | "none";

const LABELS: Record<OrderAutomationStatus, { emoji: string; label: string }> = {
  success: { emoji: "🟢", label: "Automated" },
  failed: { emoji: "🔴", label: "Automation Failed" },
  none: { emoji: "⚪", label: "No Automation" },
};

export function WorkflowStatusBadge({ status }: { status: OrderAutomationStatus }) {
  const { emoji, label } = LABELS[status];

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span aria-hidden="true">{emoji}</span>
      {label}
    </span>
  );
}
