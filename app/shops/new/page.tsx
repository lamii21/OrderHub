import { createShop } from "./actions";
import { FormField } from "@/components/form-field";
import { SheetCreatedPanel } from "@/components/sheet-created-panel";
import { SubmitButton } from "@/components/submit-button";
import { GoogleAccountCard } from "@/components/google-account-card";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getGoogleConnectionStatus } from "@/lib/google-oauth";

export default async function NewShopPage({
  searchParams,
}: {
  searchParams: Promise<{
    sheet_id?: string;
    error?: string;
    google_connected?: string;
    google_error?: string;
  }>;
}) {
  const { sheet_id: sheetId, error, google_connected: googleConnected, google_error: googleError } =
    await searchParams;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const googleStatus = user
    ? await getGoogleConnectionStatus(user.id)
    : { connected: false, email: null };

  if (sheetId) {
    return (
      <main className="mx-auto max-w-md p-6">
        <SheetCreatedPanel title="Google Sheet created successfully" sheetId={sheetId} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-2xl font-semibold">New Shop</h1>
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      )}
      {googleConnected && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Google account connected.
        </p>
      )}
      {googleError && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(googleError)}
        </p>
      )}
      <GoogleAccountCard
        connected={googleStatus.connected}
        email={googleStatus.email}
        redirectTo="/shops/new"
      />
      <form action={createShop} className="space-y-4 rounded-lg border bg-white p-6">
        <FormField id="name" name="name" label="Shop Name" required />
        <div>
          <label htmlFor="platform" className="mb-1 block text-sm font-medium text-gray-700">
            Platform
          </label>
          <select
            id="platform"
            name="platform"
            required
            defaultValue="Shopify"
            className="w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="Shopify">Shopify</option>
            <option value="YouCan">YouCan</option>
            <option value="WooCommerce">WooCommerce</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <SubmitButton pendingLabel="Creating shop…">Create Shop</SubmitButton>
      </form>
    </main>
  );
}
