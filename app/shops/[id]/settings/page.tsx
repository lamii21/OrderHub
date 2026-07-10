import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ErrorBanner } from "@/components/error-banner";
import { DetailRow } from "@/components/detail-modal";
import { StatCard } from "@/components/stat-card";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { ShopHealthBadge } from "@/components/shop-health-badge";
import { formatRelativeTime } from "@/lib/utils";
import { SYNC_FREQUENCIES, computeNextSyncAt } from "@/lib/sync-schedule";
import { CURRENCIES, getTimezones } from "@/lib/shop-settings";
import { disconnectStore } from "@/app/shops/actions";
import { updateShopSettings, updateNotificationSettings, regenerateSpreadsheet } from "./actions";
import type { ShopWithStats } from "@/types/shop";

export const revalidate = 0;

type SearchParams = { saved?: string; regenerated?: string; error?: string };

export default async function ShopSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // Same RPC every other shop page already uses — reused rather than
  // writing a settings-specific query for data that's already there.
  const supabase = await createSupabaseServerClient();
  const { data: shops, error } = await supabase.rpc("get_shops_with_stats");

  if (error) {
    console.error("Shop settings load failed:", error);
    return (
      <ErrorBanner message="We couldn't load this shop's settings right now. Please refresh the page in a moment." />
    );
  }

  const shop = (shops as ShopWithStats[]).find((s) => s.id === Number(id));

  if (!shop) {
    notFound();
  }

  const nextSyncAt = shop.store_url ? computeNextSyncAt(shop) : null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{shop.name} — Settings</h1>
          <Link href={`/shops/${shop.id}`} className="text-sm text-blue-600 hover:underline">
            ← Back to {shop.name}
          </Link>
        </div>
        <ShopHealthBadge shop={shop} />
      </div>

      {sp.saved && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Settings saved.
        </p>
      )}
      {sp.regenerated && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          A new spreadsheet was created and linked to this shop.
        </p>
      )}
      {sp.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error)}
        </p>
      )}

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">General Settings</h2>
        <form action={updateShopSettings} className="space-y-4">
          <input type="hidden" name="shop_id" value={shop.id} />

          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
              Store Display Name
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

          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Platform</span>
            <p className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {shop.platform}
            </p>
          </div>

          <div>
            <label htmlFor="store_url" className="mb-1 block text-sm font-medium text-gray-700">
              Store URL
            </label>
            <input
              id="store_url"
              name="store_url"
              type="text"
              defaultValue={shop.store_url ?? ""}
              placeholder="my-shop.myshopify.com or my-store.com"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
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

          <div>
            <label htmlFor="currency" className="mb-1 block text-sm font-medium text-gray-700">
              Default Currency
            </label>
            <select
              id="currency"
              name="currency"
              defaultValue={shop.currency}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm font-medium text-gray-700">
              Default Timezone
            </label>
            <select
              id="timezone"
              name="timezone"
              defaultValue={shop.timezone}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {getTimezones().map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </div>

          <SubmitButton pendingLabel="Saving…">Save General Settings</SubmitButton>
        </form>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Notification Settings</h2>
        <form action={updateNotificationSettings} className="space-y-3">
          <input type="hidden" name="shop_id" value={shop.id} />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="sync_products_enabled"
              defaultChecked={shop.sync_products_enabled}
            />
            Automatically sync products
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="sync_orders_enabled"
              defaultChecked={shop.sync_orders_enabled}
            />
            Automatically sync orders
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="auto_sync_enabled"
              defaultChecked={shop.auto_sync_enabled}
            />
            Enable automatic synchronization
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="email_notifications_enabled"
              defaultChecked={shop.email_notifications_enabled}
            />
            Email notifications
            <span className="text-xs text-gray-400">(coming soon — no emails are sent yet)</span>
          </label>

          <SubmitButton pendingLabel="Saving…">Save Notification Settings</SubmitButton>
        </form>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Google Sheets</h2>
        <dl className="mb-4 space-y-2 text-sm">
          <DetailRow label="Spreadsheet ID" value={shop.sheet_id} />
          <DetailRow label="Spreadsheet Name" value={shop.sheet_name} />
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          {shop.sheet_id && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${shop.sheet_id}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Open Spreadsheet
            </a>
          )}

          <ConfirmActionForm
            shopId={shop.id}
            action={regenerateSpreadsheet}
            buttonLabel="Regenerate Spreadsheet"
            pendingLabel="Regenerating…"
            confirmMessage="Regenerate the spreadsheet? This creates a brand new Google Sheet and links it to this shop — the old one stays in your Drive but is no longer linked here. This cannot be undone."
          >
            <div className="mb-2">
              <label htmlFor="owner_email" className="mb-1 block text-xs font-medium text-gray-700">
                Share new spreadsheet with (Google account email)
              </label>
              <input
                id="owner_email"
                name="owner_email"
                type="email"
                required
                placeholder="you@gmail.com"
                className="w-64 rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </ConfirmActionForm>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">API Credentials</h2>
        <dl className="mb-4 space-y-2 text-sm">
          <DetailRow label="Status" value={shop.store_url ? "Configured" : "Not configured"} />
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/shops/connect?reconnect=${shop.id}`}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Replace Credentials
          </Link>

          {shop.store_url && (
            <ConfirmActionForm
              shopId={shop.id}
              action={disconnectStore}
              buttonLabel="Remove Credentials"
              pendingLabel="Removing…"
              confirmMessage={`Remove stored credentials for "${shop.name}"? This stops automatic synchronization. Orders, products, and history are kept — you can reconnect anytime.`}
            />
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Synchronization</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Last Sync"
            value={
              shop.last_sync_attempt_at
                ? formatRelativeTime(new Date(shop.last_sync_attempt_at))
                : "Never"
            }
          />
          <StatCard
            label="Next Sync"
            value={
              !shop.store_url ? (
                <span className="text-gray-400">—</span>
              ) : nextSyncAt && nextSyncAt.getTime() > Date.now() ? (
                nextSyncAt.toLocaleString()
              ) : (
                "Due now"
              )
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
      </div>
    </main>
  );
}
