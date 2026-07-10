"use client";

import { useState, useTransition } from "react";
import { updateOrderStatus } from "@/app/dashboard/actions";
import { ORDER_STATUSES } from "@/lib/validation";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800",
  confirmed: "bg-blue-100 text-blue-800",
  processing: "bg-yellow-100 text-yellow-800",
  shipped: "bg-indigo-100 text-indigo-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

export function StatusSelect({ orderId, status }: { orderId: number; status: string }) {
  const [value, setValue] = useState(status);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const previous = value;
    const next = event.target.value;
    setValue(next);
    setFailed(false);

    startTransition(async () => {
      try {
        await updateOrderStatus(orderId, next);
      } catch {
        setValue(previous);
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={handleChange}
        disabled={isPending}
        className={`rounded-md border-0 px-2 py-1 text-xs font-medium capitalize disabled:opacity-50 ${
          STATUS_STYLES[value] ?? STATUS_STYLES.pending
        }`}
      >
        {ORDER_STATUSES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {isPending && <span className="text-xs text-gray-400">Saving…</span>}
      {failed && !isPending && (
        <span className="text-xs text-red-600">Update failed, try again</span>
      )}
    </div>
  );
}
