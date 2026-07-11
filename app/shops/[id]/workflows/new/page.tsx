import Link from "next/link";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { EVENT_TYPES, getEventTypeLabel } from "@/lib/events/types";
import { createWorkflow } from "../actions";

// Deliberately 2 fields — a workflow's steps are configured on its own
// editor page right after creation, never here. Same idiom as
// /shops/new -> /shops/[id]/settings (Builder specification §1).
export default async function NewWorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-1 text-2xl font-semibold">New Workflow</h1>
      <Link href={`/shops/${id}/workflows`} className="text-sm text-blue-600 hover:underline">
        ← Back to Workflows
      </Link>

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      )}

      <form action={createWorkflow} className="mt-4 space-y-4 rounded-lg border bg-white p-6">
        <input type="hidden" name="shop_id" value={id} />
        <FormField id="name" name="name" label="Workflow Name" required />
        <div>
          <label htmlFor="trigger_event" className="mb-1 block text-sm font-medium text-gray-700">
            Trigger Event
          </label>
          <select
            id="trigger_event"
            name="trigger_event"
            required
            defaultValue={EVENT_TYPES[0]}
            className="w-full rounded-md border px-3 py-2 text-sm"
          >
            {EVENT_TYPES.map((eventType) => (
              <option key={eventType} value={eventType}>
                {getEventTypeLabel(eventType)}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton pendingLabel="Creating…">Create Workflow</SubmitButton>
      </form>
    </main>
  );
}
