import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ErrorBanner } from "@/components/error-banner";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { ShopHealthBadge } from "@/components/shop-health-badge";
import { SubmitButton } from "@/components/submit-button";
import { deleteShop, disconnectStore } from "./actions";
import { testConnection } from "@/app/shops/connect/actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";
import { computeNextSyncAt, SYNC_FREQUENCIES } from "@/lib/sync-schedule";
import type { ShopWithStats } from "@/types/shop";

export const revalidate = 0;

type SearchParams = {
  deleted?: string;
  disconnected?: string;
  error?: string;
  shop_id?: string;
  test?: string;
};

const FREQUENCY_LABELS: Record<string, string> = Object.fromEntries(
  SYNC_FREQUENCIES.map((f) => [f.value, f.label])
);

export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { deleted, disconnected, error: actionError, shop_id: testedShopId, test } =
    await searchParams;

  // Queried as the logged-in user, so RLS scopes this to their own shops —
  // no manual filter needed.
  const supabase = await createSupabaseServerClient();
  const { data: shops, error } = await supabase.rpc("get_shops_with_stats");

  if (error) {
    console.error("Shops load failed:", error);
    return (
      <ErrorBanner message="We couldn't load your shops right now. Please refresh the page in a moment." />
    );
  }

  const rows = shops as ShopWithStats[];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shops</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/shops/new" className="text-blue-600 hover:underline">
            + New Shop
          </Link>
          <Link href="/shops/connect" className="text-blue-600 hover:underline">
            Connect Store
          </Link>
        </div>
      </div>

      {deleted && (
        <p className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Shop deleted.
        </p>
      )}
      {disconnected && (
        <p className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Store disconnected. Its orders, products, and history are still here — reconnect it
          anytime from this page.
        </p>
      )}
      {actionError && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(actionError)}
        </p>
      )}

      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shop Name</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sync Frequency</TableHead>
              <TableHead>Last Sync</TableHead>
              <TableHead>Next Sync</TableHead>
              <TableHead>Products</TableHead>
              <TableHead>Orders</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((shop) => {
              const isConnected = Boolean(shop.store_url);
              const nextSyncAt = isConnected ? computeNextSyncAt(shop) : null;

              return (
                <TableRow key={shop.id}>
                  <TableCell>{shop.name}</TableCell>
                  <TableCell>{shop.platform}</TableCell>
                  <TableCell>
                    <ShopHealthBadge shop={shop} />
                    {testedShopId === String(shop.id) && test && (
                      <div
                        className={`mt-1 text-xs ${
                          test === "success" ? "text-green-700" : "text-red-700"
                        }`}
                      >
                        {test === "success" ? "✓ Connection test passed" : "✗ Connection test failed"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {isConnected ? (
                      FREQUENCY_LABELS[shop.sync_frequency] ?? shop.sync_frequency
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isConnected ? (
                      shop.last_sync_attempt_at ? (
                        formatRelativeTime(new Date(shop.last_sync_attempt_at))
                      ) : (
                        <span className="text-gray-400">Never</span>
                      )
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isConnected ? (
                      nextSyncAt && nextSyncAt.getTime() > Date.now() ? (
                        nextSyncAt.toLocaleString()
                      ) : (
                        <span className="text-green-700">Due now</span>
                      )
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>{Number(shop.product_count)}</TableCell>
                  <TableCell>{Number(shop.order_count)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-3">
                      <Link href={`/shops/${shop.id}`} className="text-blue-600 hover:underline">
                        View
                      </Link>
                      <Link
                        href={`/shops/${shop.id}/settings`}
                        className="text-blue-600 hover:underline"
                      >
                        Settings
                      </Link>

                      {isConnected ? (
                        <>
                          <form action={testConnection}>
                            <input type="hidden" name="shop_id" value={shop.id} />
                            <input type="hidden" name="redirect_to" value="/shops" />
                            <SubmitButton variant="secondary" pendingLabel="Testing…">
                              Test Connection
                            </SubmitButton>
                          </form>

                          <ConfirmActionForm
                            shopId={shop.id}
                            action={disconnectStore}
                            buttonLabel="Disconnect"
                            pendingLabel="Disconnecting…"
                            confirmMessage={`Disconnect "${shop.name}"? This removes its stored credentials and stops automatic synchronization. Orders, products, and history are kept — you can reconnect it anytime.`}
                          />
                        </>
                      ) : (
                        <Link
                          href={`/shops/connect?reconnect=${shop.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          Reconnect
                        </Link>
                      )}

                      <ConfirmActionForm
                        shopId={shop.id}
                        action={deleteShop}
                        buttonLabel="Delete"
                        pendingLabel="Deleting…"
                        confirmMessage={`Delete "${shop.name}"? This also deletes all of its orders and products. This cannot be undone.`}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <p className="p-6 text-center text-gray-500">
            No shops yet. Create one to get started.
          </p>
        )}
      </div>
    </main>
  );
}
