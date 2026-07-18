import { ActionCard } from "@/components/action-card";
import { syncProducts, syncOrders } from "@/app/shops/connect/actions";

// Sync Products and Sync Orders look like twin actions (same card style, same
// button shape) but behave differently: products land in OrderHub the moment
// the sync finishes, orders land in the shop's Google Sheet first and only
// reach OrderHub once the Apps Script relays them from there. That gap reads
// as "nothing happened" during a live demo unless it's called out explicitly
// — this component is the one place both the info box and the post-sync
// explanation live, reused by both /shops/connect (right after connecting)
// and /shops/[id] (every time the merchant returns). UI-only: neither
// syncProducts nor syncOrders (app/shops/connect/actions.ts) changed.
export function SyncActionsPanel({
  shopId,
  platform,
  sheetId,
  productsSynced,
  ordersSynced,
  redirectTo,
  continueHref,
}: {
  shopId: number;
  platform: string | null;
  sheetId: string | null;
  productsSynced?: string;
  ordersSynced?: string;
  redirectTo?: string;
  continueHref: string;
}) {
  return (
    <>
      <ActionCard
        title="Sync Products"
        action={syncProducts}
        shopId={shopId}
        buttonLabel="Sync Products Now"
        pendingLabel="Syncing products…"
        redirectTo={redirectTo}
      >
        {productsSynced !== undefined && (
          <p className="mb-2 text-sm text-gray-600">
            Synced {productsSynced} product(s) from {platform ?? "the store"}.
          </p>
        )}
      </ActionCard>

      <ActionCard
        title="Sync Orders"
        action={syncOrders}
        shopId={shopId}
        buttonLabel="Sync Orders Now"
        pendingLabel="Syncing orders…"
        redirectTo={redirectTo}
      >
        {ordersSynced !== undefined && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-5">
            <p className="mb-2 text-sm font-semibold text-green-800">
              ✅ {ordersSynced} order{ordersSynced === "1" ? "" : "s"} synchronized to your Google
              Spreadsheet.
            </p>
            <p className="mb-4 text-sm text-green-700">
              <span className="font-medium">Next step:</span> open your spreadsheet and click{" "}
              <span className="font-medium">&quot;Send Orders to OrderHub&quot;</span> in the
              OrderHub menu to import them into OrderHub.
            </p>
            <div className="flex flex-wrap gap-3">
              {sheetId && (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${sheetId}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Open Spreadsheet
                </a>
              )}
              <a
                href={continueHref}
                className="inline-block rounded-md border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-50"
              >
                Continue
              </a>
            </div>
          </div>
        )}
      </ActionCard>

      <div className="rounded-lg border bg-white p-5 text-sm">
        <div className="mb-3">
          <p className="font-medium text-gray-900">Products Sync</p>
          <p className="text-gray-600">Products appear immediately inside OrderHub.</p>
        </div>
        <div>
          <p className="font-medium text-gray-900">Orders Sync</p>
          <p className="text-gray-600">
            Orders are first synchronized into Google Sheets before being imported into OrderHub.
          </p>
        </div>
      </div>
    </>
  );
}
