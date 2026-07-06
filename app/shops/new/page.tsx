import { createShop } from "./actions";
import { FormField } from "@/components/form-field";
import { SheetCreatedPanel } from "@/components/sheet-created-panel";
import { SubmitButton } from "@/components/submit-button";

export default async function NewShopPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet_id?: string; error?: string }>;
}) {
  const { sheet_id: sheetId, error } = await searchParams;

  if (sheetId) {
    return (
      <main className="mx-auto max-w-md p-6">
        <SheetCreatedPanel title="Google Sheet created successfully" sheetId={sheetId} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">New Shop</h1>
      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      )}
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
        <FormField
          id="owner_email"
          name="owner_email"
          label="Your Google Account Email"
          type="email"
          required
          placeholder="you@gmail.com"
          hint="The new spreadsheet will be shared with this address so you can open and edit it."
        />
        <SubmitButton pendingLabel="Creating shop and Google Sheet…">Create Shop</SubmitButton>
      </form>
    </main>
  );
}
