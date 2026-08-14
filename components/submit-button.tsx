"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const PRIMARY =
  "w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY =
  "rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60";

// Shows a pending label while its parent <form action={...}> is submitting.
// Must be rendered inside the <form> — useFormStatus reads the nearest one.
// className is optional and merged (via cn()/tailwind-merge) after the
// variant's own classes, so a caller can override e.g. width/shape (the
// Console's pill-shaped send button) without losing the pending-state
// behavior every other submit button in the app already relies on.
export function SubmitButton({
  children,
  pendingLabel = "Working…",
  variant = "primary",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(variant === "primary" ? PRIMARY : SECONDARY, className)}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
