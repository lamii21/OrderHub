import { login } from "./actions";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-sm p-6 pt-24">
      <h1 className="mb-4 text-2xl font-semibold">Log In</h1>
      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      )}
      <form action={login} className="space-y-4 rounded-lg border bg-white p-6">
        <FormField id="email" name="email" label="Email" type="email" required />
        <FormField id="password" name="password" label="Password" type="password" required />
        <SubmitButton pendingLabel="Logging in…">Log In</SubmitButton>
      </form>
    </main>
  );
}
