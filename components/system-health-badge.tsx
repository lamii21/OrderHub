import { HEALTH_LABELS, type HealthStatus } from "@/lib/system-health";

export function SystemHealthBadge({ status }: { status: HealthStatus }) {
  const { emoji, label } = HEALTH_LABELS[status];

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span aria-hidden="true">{emoji}</span>
      {label}
    </span>
  );
}
