"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="mb-2 text-xl font-semibold text-red-700">Something went wrong</h1>
      <p className="mb-4 text-sm text-gray-500">
        An unexpected error occurred. You can try again, or come back in a moment.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Try again
      </button>
    </main>
  );
}
