import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getGoogleConnectionStatus } from "@/lib/google-oauth";
import { ErrorBanner } from "@/components/error-banner";
import { DetailRow } from "@/components/detail-modal";
import { StatCard } from "@/components/stat-card";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { ShopHealthBadge } from "@/components/shop-health-badge";
import { GoogleAccountCard } from "@/components/google-account-card";
import { formatRelativeTime } from "@/lib/utils";
import { SYNC_FREQUENCIES, computeNextSyncAt } from "@/lib/sync-schedule";
import { CURRENCIES, getTimezones } from "@/lib/shop-settings";
import { disconnectStore } from "@/app/shops/actions";
import {
  updateShopSettings,
  updateNotificationSettings,
  regenerateSpreadsheet,
  regenerateWebhookSecret,
} from "./actions";
import type { ShopWithStats } from "@/types/shop";

export const revalidate = 0;

type SearchParams = {
  saved?: string;
  regenerated?: string;
  secret_regenerated?: string;
  error?: string;
  google_connected?: string;
  google_disconnected?: string;
  google_error?: string;
};

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: shops, error }, { data: secretRow, error: secretError }, googleStatus] = await Promise.all([
    supabase.rpc("get_shops_with_stats"),
    // webhook_secret is deliberately NOT part of get_shops_with_stats()'s
    // output — that RPC backs several pages, and a secret has no business
    // being included anywhere it isn't specifically needed. Fetched here,
    // on the one page that actually displays it, via a targeted query on
    // just this column. RLS's "Users can view their own shops" policy is
    // what actually stops this from returning another user's secret.
    supabase.from("shops").select("webhook_secret").eq("id", id).single(),
    user ? getGoogleConnectionStatus(user.id) : Promise.resolve({ connected: false, email: null }),
  ]);

  if (error) {
    console.error("Shop settings load failed:", error);
    return (
      <ErrorBanner message="We couldn't load this shop's settings right now. Please refresh the page in a moment." />
    );
  }

  if (secretError) {
    console.error("Shop settings: failed to load webhook secret:", secretError);
  }

  const shop = (shops as ShopWithStats[]).find((s) => s.id === Number(id));

  if (!shop) {
    notFound();
  }

  const webhookSecret = secretRow?.webhook_secret ?? null;

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
      {sp.secret_regenerated && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          A new webhook secret was generated. Update any integration still using the old one — it
          no longer works.
        </p>
      )}
      {sp.google_connected && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Google account connected.
        </p>
      )}
      {sp.google_disconnected && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Google account disconnected.
        </p>
      )}
      {(sp.error || sp.google_error) && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(sp.error ?? sp.google_error ?? "")}
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
          <div>
            {/* A disabled checkbox is never included in submitted form data
                — this hidden input preserves whatever value is already
                stored so saving the rest of this form can't silently flip
                it to false. updateNotificationSettings itself (actions.ts)
                is unchanged: it still just reads
                formData.get("email_notifications_enabled") === "on". */}
            {shop.email_notifications_enabled && (
              <input type="hidden" name="email_notifications_enabled" value="on" />
            )}
            <label className="flex cursor-not-allowed items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={shop.email_notifications_enabled}
                disabled
                readOnly
                className="cursor-not-allowed"
              />
              Email notifications
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                Coming Soon
              </span>
            </label>
            <p className="ml-6 mt-1 text-xs text-gray-400">
              Available in a future version — no emails are sent yet.
            </p>
          </div>

          <SubmitButton pendingLabel="Saving…">Save Notification Settings</SubmitButton>
        </form>
      </div>

      <GoogleAccountCard
        connected={googleStatus.connected}
        email={googleStatus.email}
        redirectTo={`/shops/${shop.id}/settings`}
      />

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

          {googleStatus.connected ? (
            <ConfirmActionForm
              shopId={shop.id}
              action={regenerateSpreadsheet}
              buttonLabel="Regenerate Spreadsheet"
              pendingLabel="Regenerating…"
              confirmMessage="Regenerate the spreadsheet? This creates a brand new Google Sheet and links it to this shop — the old one stays in your Drive but is no longer linked here. This cannot be undone."
            />
          ) : (
            <p className="text-sm text-gray-400">Connect your Google account above to regenerate.</p>
          )}
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
        <h2 className="mb-4 text-lg font-semibold">Webhook Secret</h2>
        <p className="mb-4 text-sm text-gray-500">
          A secret scoped to only this shop. Send it as the{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">x-api-key</code> header instead
          of the shared account-wide secret so a leaked key can only ever affect this one shop.
        </p>
        <dl className="mb-4 space-y-2 text-sm">
          <DetailRow
            label="Secret"
            value={
              webhookSecret ? (
                <code className="break-all rounded bg-gray-100 px-2 py-1 text-xs">
                  {webhookSecret}
                </code>
              ) : (
                "Unavailable"
              )
            }
          />
        </dl>
        <ConfirmActionForm
          shopId={shop.id}
          action={regenerateWebhookSecret}
          buttonLabel="Regenerate Webhook Secret"
          pendingLabel="Regenerating…"
          confirmMessage="Generate a new webhook secret for this shop? The current secret stops working immediately — any integration still sending it will need to be updated with the new value shown here. This cannot be undone."
        />
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
