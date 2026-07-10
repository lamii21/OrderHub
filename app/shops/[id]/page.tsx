import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ErrorBanner } from "@/components/error-banner";
import { StatCard } from "@/components/stat-card";
import { DetailRow } from "@/components/detail-modal";
import { SubmitButton } from "@/components/submit-button";
import { ActionCard } from "@/components/action-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import { syncProducts, syncOrders, testConnection } from "@/app/shops/connect/actions";
import { updateShopName, updateSyncFrequency, disconnectStore } from "../actions";
import { SYNC_FREQUENCIES, computeNextSyncAt } from "@/lib/sync-schedule";
import { ShopHealthBadge } from "@/components/shop-health-badge";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import type { ShopWithStats } from "@/types/shop";
import type { SyncHistoryEntry } from "@/types/sync-history";

export const revalidate = 0;

type SearchParams = {
  error?: string;
  products_synced?: string;
  orders_synced?: string;
  disconnected?: string;
  test?: string;
};

export default async function ShopDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // Same RPC as /shops — reused rather than writing a second, near-identical
  // query. RLS already restricts the result to the caller's own shops, so
  // finding this one shop in that (small) list is simpler than adding a
  // parameterised variant of the function just to filter server-side.
  const supabase = await createSupabaseServerClient();
  const { data: shops, error } = await supabase.rpc("get_shops_with_stats");

  if (error) {
    console.error("Shop detail load failed:", error);
    return (
      <ErrorBanner message="We couldn't load this shop right now. Please refresh the page in a moment." />
    );
  }

  const shop = (shops as ShopWithStats[]).find((s) => s.id === Number(id));

  if (!shop) {
    notFound();
  }

  // A secondary section — if this fails, the rest of the page (which already
  // loaded fine above) still renders; only this table shows an inline error.
  const { data: history, error: historyError } = await supabase
    .from("sync_history")
    .select("*")
    .eq("shop_id", shop.id)
    .order("started_at", { ascending: false })
    .limit(20)
    .returns<SyncHistoryEntry[]>();

  if (historyError) {
    console.error("Sync history load failed:", historyError);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{shop.name}</h1>
        <div className="flex items-center gap-3">
          <ShopHealthBadge shop={shop} />
          <Link href={`/shops/${shop.id}/workflows`} className="text-sm text-blue-600 hover:underline">
            Workflows
          </Link>
          <Link href={`/shops/${shop.id}/settings`} className="text-sm text-blue-600 hover:underline">
            Settings
          </Link>
        </div>
      </div>

      {sp.disconnected && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Store disconnected. Its orders, products, and history are still here — reconnect it
          anytime below.
        </p>
      )}
      {sp.test && (
        <p
          className={`rounded-md border p-3 text-sm ${
            sp.test === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {sp.test === "success" ? "✓ Connection test passed" : "✗ Connection test failed"}
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">General Information</h2>
        <dl className="mb-6 space-y-2 text-sm">
          <DetailRow label="Platform" value={shop.platform} />
          <DetailRow label="Spreadsheet ID" value={shop.sheet_id} />
          <DetailRow label="Spreadsheet Name" value={shop.sheet_name} />
          {shop.store_url && <DetailRow label="Store URL" value={shop.store_url} />}
        </dl>

        <form action={updateShopName} className="flex items-end gap-2 border-t pt-4">
          <input type="hidden" name="shop_id" value={shop.id} />
          <div className="flex-1">
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
              Shop Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={shop.name}
              required
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Orders" value={Number(shop.order_count)} />
        <StatCard label="Products" value={Number(shop.product_count)} />
        <StatCard label="Revenue" value={Number(shop.total_revenue).toFixed(2)} />
        <StatCard
          label="Latest Synchronization"
          value={
            shop.last_sync_attempt_at
              ? formatRelativeTime(new Date(shop.last_sync_attempt_at))
              : "Never"
          }
        />
        <StatCard
          label="Last Successful Sync"
          value={
            shop.last_success_sync_at
              ? formatRelativeTime(new Date(shop.last_success_sync_at))
              : "Never"
          }
        />
        <StatCard
          label="Last Failed Sync"
          value={
            shop.last_failed_sync_at
              ? formatRelativeTime(new Date(shop.last_failed_sync_at))
              : "None"
          }
        />
      </div>

      {shop.sheet_id && (
        <a
          href={`https://docs.google.com/spreadsheets/d/${shop.sheet_id}/edit`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Open Google Sheet
        </a>
      )}

      {shop.store_url && (
        <>
          <div className="rounded-lg border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold">Automatic Synchronization</h2>
            <dl className="mb-4 space-y-2 text-sm">
              <DetailRow
                label="Next Sync"
                value={(() => {
                  const nextSyncAt = computeNextSyncAt(shop);
                  return nextSyncAt && nextSyncAt.getTime() > Date.now()
                    ? nextSyncAt.toLocaleString()
                    : "Due now";
                })()}
              />
            </dl>

            <form
              action={updateSyncFrequency}
              className="flex items-end gap-2 border-t pt-4"
            >
              <input type="hidden" name="shop_id" value={shop.id} />
              <div className="flex-1">
                <label
                  htmlFor="sync_frequency"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Sync Frequency
                </label>
                <select
                  id="sync_frequency"
                  name="sync_frequency"
                  defaultValue={shop.sync_frequency}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {SYNC_FREQUENCIES.map((frequency) => (
                    <option key={frequency.value} value={frequency.value}>
                      {frequency.label}
                    </option>
                  ))}
                </select>
              </div>
              <SubmitButton variant="secondary" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </form>
          </div>

          <div className="rounded-lg border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold">Store Connection</h2>
            <div className="flex flex-wrap items-center gap-3">
              <form action={testConnection}>
                <input type="hidden" name="shop_id" value={shop.id} />
                <input type="hidden" name="redirect_to" value={`/shops/${shop.id}`} />
                <SubmitButton variant="secondary" pendingLabel="Testing…">
                  Test Connection
                </SubmitButton>
              </form>

              <ConfirmActionForm
                shopId={shop.id}
                action={disconnectStore}
                buttonLabel="Disconnect Store"
                pendingLabel="Disconnecting…"
                confirmMessage={`Disconnect "${shop.name}"? This removes its stored credentials and stops automatic synchronization. Orders, products, and history are kept — you can reconnect it anytime.`}
              />
            </div>
          </div>

          <ActionCard
            title="Sync Products"
            action={syncProducts}
            shopId={shop.id}
            buttonLabel="Sync Products Now"
            pendingLabel="Syncing products…"
            redirectTo={`/shops/${shop.id}`}
          >
            {sp.products_synced !== undefined && (
              <p className="mb-2 text-sm text-gray-600">
                Synced {sp.products_synced} product(s) from {shop.platform}.
              </p>
            )}
          </ActionCard>

          <ActionCard
            title="Sync Orders"
            action={syncOrders}
            shopId={shop.id}
            buttonLabel="Sync Orders Now"
            pendingLabel="Syncing orders…"
            redirectTo={`/shops/${shop.id}`}
          >
            {sp.orders_synced !== undefined && (
              <p className="mb-2 text-sm text-gray-600">
                Sent {sp.orders_synced} new order line(s) to the Google Sheet.
              </p>
            )}
          </ActionCard>
        </>
      )}

      {!shop.store_url && (
        <div className="rounded-lg border bg-white p-6 text-center">
          <p className="mb-3 text-sm text-gray-600">
            This store is disconnected. Its orders, products, and history are kept — reconnect it
            to resume automatic synchronization.
          </p>
          <Link
            href={`/shops/connect?reconnect=${shop.id}`}
            className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Reconnect Store
          </Link>
        </div>
      )}

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Synchronization History</h2>
        {historyError ? (
          <p className="text-sm text-red-600">Couldn&apos;t load sync history.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Imported</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{new Date(entry.started_at).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{entry.type}</TableCell>
                    <TableCell>
                      <span
                        className={entry.status === "success" ? "text-green-700" : "text-red-700"}
                      >
                        {entry.status === "success" ? "Success" : "Failed"}
                      </span>
                    </TableCell>
                    <TableCell>{entry.imported_count ?? "-"}</TableCell>
                    <TableCell>{formatDuration(entry.duration_ms)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(!history || history.length === 0) && (
              <p className="p-4 text-center text-gray-500">No synchronization history yet.</p>
            )}
          </>
        )}
      </div>

      <Link href="/shops" className="inline-block text-sm text-blue-600 hover:underline">
        ← Back to Shops
      </Link>
    </main>
  );
}
