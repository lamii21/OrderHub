import { disconnectGoogleAccount } from "@/app/shops/actions";
import { SubmitButton } from "@/components/submit-button";

// Shown wherever a user can either connect their Google account for the
// first time or manage an existing connection (app/shops/new/page.tsx,
// app/shops/connect/page.tsx, app/shops/[id]/settings/page.tsx). Not
// shop-scoped — the connection belongs to the app user, reused across every
// shop they create — so redirectTo is a plain page path, not a shop_id.
export function GoogleAccountCard({
  connected,
  email,
  redirectTo,
}: {
  connected: boolean;
  email: string | null;
  redirectTo: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-6">
      <h2 className="mb-2 text-lg font-semibold">Google Account</h2>
      {connected ? (
        <>
          <p className="mb-4 text-sm text-gray-500">
            Connected as <span className="font-medium text-gray-700">{email}</span>. Spreadsheets are
            created directly in this account&apos;s own Google Drive.
          </p>
          <form action={disconnectGoogleAccount}>
            <input type="hidden" name="redirect_to" value={redirectTo} />
            <SubmitButton variant="secondary" pendingLabel="Disconnecting...">
              Disconnect
            </SubmitButton>
          </form>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-500">
            Connect a Google account to automatically create a Google Sheet for each shop.
          </p>
          <a
            href={`/api/google/connect?redirect_to=${encodeURIComponent(redirectTo)}`}
            className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Connect Google Account
          </a>
        </>
      )}
    </div>
  );
}
