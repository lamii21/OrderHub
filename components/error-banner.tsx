// A clean, user-facing stand-in for a failed data fetch. The real error is
// expected to already be logged server-side (console.error) before this
// renders — this component never shows raw Supabase/Google/Shopify error text.
export function ErrorBanner({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {message}
      </p>
    </main>
  );
}
