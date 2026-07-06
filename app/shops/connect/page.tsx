import { createSupabaseServerClient } from "@/lib/supabase-server";
import { connectShop, testConnection, syncProducts, syncOrders } from "./actions";
import { FormField } from "@/components/form-field";
import { SheetCreatedPanel } from "@/components/sheet-created-panel";
import { SubmitButton } from "@/components/submit-button";
import { ActionCard } from "@/components/action-card";

type SearchParams = {
  shop_id?: string;
  test?: string;
  products_synced?: string;
  orders_synced?: string;
  error?: string;
};

export default async function ConnectShopifyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  if (params.shop_id) {
    // Queried as the logged-in user (not the service-role client), so RLS's
    // "user_id = auth.uid()" policy on shops means a shop_id belonging to
    // someone else simply comes back as no row — not an error, not a leak.
    const supabase = await createSupabaseServerClient();
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("id, name, sheet_id")
      .eq("id", params.shop_id)
      .single();

    if (shopError || !shop) {
      return (
        <p className="p-6 text-red-600">
          We couldn&apos;t find that shop. It may have been deleted.
        </p>
      );
    }

    return (
      <main className="mx-auto max-w-md space-y-6 p-6">
        <SheetCreatedPanel
          title={`${shop.name} connected`}
          sheetId={shop.sheet_id}
          description="A Google Sheet was created and linked to this shop."
        />

        {params.error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {decodeURIComponent(params.error)}
          </p>
        )}

        <ActionCard
          title="Test Connection"
          action={testConnection}
          shopId={shop.id}
          buttonLabel="Test Connection"
          pendingLabel="Testing…"
        >
          {params.test === "success" && (
            <p className="mb-2 text-sm text-green-700">✓ Connection successful</p>
          )}
          {params.test === "failed" && (
            <p className="mb-2 text-sm text-red-700">✗ Connection failed</p>
          )}
        </ActionCard>

        <ActionCard
          title="Sync Products"
          action={syncProducts}
          shopId={shop.id}
          buttonLabel="Sync Products Now"
          pendingLabel="Syncing products…"
        >
          {params.products_synced !== undefined && (
            <p className="mb-2 text-sm text-gray-600">
              Synced {params.products_synced} product(s) from Shopify.
            </p>
          )}
        </ActionCard>

        <ActionCard
          title="Sync Orders"
          action={syncOrders}
          shopId={shop.id}
          buttonLabel="Sync Orders Now"
          pendingLabel="Syncing orders…"
        >
          {params.orders_synced !== undefined && (
            <p className="mb-2 text-sm text-gray-600">
              Sent {params.orders_synced} new order line(s) to the Google Sheet.
            </p>
          )}
        </ActionCard>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">Connect Shopify Store</h1>
      {params.error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(params.error)}
        </p>
      )}
      <form action={connectShop} className="space-y-4 rounded-lg border bg-white p-6">
        <FormField id="name" name="name" label="Shop Name" required />
        <FormField
          id="store_url"
          name="store_url"
          label="Shopify Store URL"
          required
          placeholder="my-shop.myshopify.com"
        />
        <FormField
          id="access_token"
          name="access_token"
          label="Admin API Access Token"
          type="password"
          required
        />
        <FormField
          id="owner_email"
          name="owner_email"
          label="Your Google Account Email"
          type="email"
          required
          placeholder="you@gmail.com"
          hint="The new spreadsheet will be shared with this address so you can open and edit it."
        />
        <SubmitButton pendingLabel="Connecting to Shopify…">Connect Shop</SubmitButton>
      </form>
    </main>
  );
}
