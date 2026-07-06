"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

const PRIMARY =
  "w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY =
  "rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";

// Shows a pending label while its parent <form action={...}> is submitting.
// Must be rendered inside the <form> — useFormStatus reads the nearest one.
export function SubmitButton({
  children,
  pendingLabel = "Working…",
  variant = "primary",
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={variant === "primary" ? PRIMARY : SECONDARY}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
