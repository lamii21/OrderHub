import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A single, reusable status pill — introduced alongside the design tokens
// (app/globals.css) rather than rewriting the existing emoji-based badges
// (WorkflowStatusBadge, ShopHealthBadge, SystemHealthBadge), which already
// work and aren't part of this pass. Used by newly-built/redesigned
// surfaces (Agent settings, Console) instead of a fresh ad hoc
// `rounded-full` span each time.
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
  info: "bg-info-100 text-info-700",
  brand: "bg-brand-100 text-brand-700",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
