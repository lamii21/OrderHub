import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// The one entry point the main nav links to. Workflows live under a
// specific shop (app/shops/[id]/workflows/page.tsx, unchanged, still the
// only place a workflow is actually listed/edited) — this page's only job
// is picking which shop's workflows to show, so "Workflows" in the nav
// isn't buried behind Shops -> a shop -> "Manage Workflows" anymore. Zero
// shops or exactly one shop skip the picker entirely via a server-side
// redirect; the picker only renders when there's a real choice to make.
export default async function WorkflowsEntryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name, platform")
    .order("name");

  if (error) {
    console.error("Workflows entry page: failed to load shops:", error);
    return (
      <main className="mx-auto max-w-md p-6">
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          We couldn&apos;t load your shops right now. Please refresh the page in a moment.
        </p>
      </main>
    );
  }

  if (!shops || shops.length === 0) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="rounded-lg border bg-white p-6 text-center">
          <h1 className="mb-2 text-xl font-semibold">No shops yet</h1>
          <p className="mb-4 text-sm text-gray-500">
            Workflows automate what happens when an order comes in for a shop. Create a shop
            first to get started.
          </p>
          <Link
            href="/shops/new"
            className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Create a Shop
          </Link>
        </div>
      </main>
    );
  }

  if (shops.length === 1) {
    redirect(`/shops/${shops[0].id}/workflows`);
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Workflows</h1>
      <p className="text-sm text-gray-500">Choose a shop to manage its workflows.</p>
      <div className="divide-y rounded-lg border bg-white">
        {shops.map((shop) => (
          <Link
            key={shop.id}
            href={`/shops/${shop.id}/workflows`}
            className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">{shop.name}</span>
            <span className="text-gray-400">{shop.platform} →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
