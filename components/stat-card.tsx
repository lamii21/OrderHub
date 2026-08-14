import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// icon/tone are both optional and additive — every existing call site
// (<StatCard label="..." value={...} />, used across dashboard/products/
// admin/analytics) renders exactly as before; only new/updated call sites
// that opt in get the icon chip + accent treatment.
export type StatCardTone = "neutral" | "brand" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<StatCardTone, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  brand: "bg-brand-50 text-brand-600",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-600",
  danger: "bg-danger-50 text-danger-600",
};

export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: StatCardTone;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-neutral-500">{label}</p>
        {icon && (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", TONE_CLASSES[tone])}>
            {icon}
          </span>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{value}</div>
    </div>
  );
}
