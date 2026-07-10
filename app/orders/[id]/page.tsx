import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DetailRow } from "@/components/detail-modal";
import { WorkflowStatusBadge, type OrderAutomationStatus } from "@/components/workflow-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import type { Order } from "@/types/order";
import type { OrderHistoryEntry } from "@/types/order-history";

export const revalidate = 0;

export default async function OrderDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Queried as the logged-in user: the existing "view orders for their own
  // shops" RLS policy means an order that isn't the caller's own simply
  // doesn't come back — same as any nonexistent id, both hit notFound()
  // below, so no ownership is ever leaked either way.
  const supabase = await createSupabaseServerClient();

  const [orderResult, historyResult, userResult, executionsResult] = await Promise.all([
    supabase.from("orders").select("*, shops(name, platform)").eq("id", id).single(),
    supabase
      .from("order_history")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase.auth.getUser(),
    // Every workflow_executions row for this order, across every workflow
    // that has ever run against it — backs the Automation section and the
    // Order Timeline below. Same "own failure doesn't block the rest of
    // the page" rule as order_history.
    supabase
      .from("workflow_executions")
      .select("*, workflows(name)")
      .eq("order_id", id)
      .order("started_at", { ascending: false }),
  ]);

  const { data: orderData, error: orderError } = orderResult;

  if (orderError || !orderData) {
    notFound();
  }

  const order = orderData as Order;
  const { data: history, error: historyError } = historyResult;

  if (historyError) {
    console.error("Order history load failed:", historyError);
  }

  const { data: executionsData, error: executionsError } = executionsResult;

  if (executionsError) {
    console.error("Order workflow execution history load failed:", executionsError);
  }

  const executions = (executionsData ?? []) as (Record<string, unknown> & {
    workflows: { name: string } | null;
  })[];
  // Already sorted newest-first by the query above.
  const latestExecution = executions[0] as
    | (Record<string, unknown> & { workflows: { name: string } | null })
    | undefined;
  const automationStatus: OrderAutomationStatus = !latestExecution
    ? "none"
    : (latestExecution.status as string) === "success"
      ? "success"
      : "failed";
  const failedSteps = executions.filter((e) => e.status === "failed");

  // Every shop has exactly one owner (no multi-user shops in this app), and
  // RLS only lets that owner see this order's history at all — so
  // changed_by is always the viewing user's own id. That means their own
  // session already has everything needed to label the "Changed By" column;
  // no join to auth.users (not directly queryable via PostgREST anyway) is
  // needed.
  const {
    data: { user },
  } = userResult;

  const total =
    order.price != null && order.quantity != null
      ? (order.price * order.quantity).toFixed(2)
      : "-";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Order #{order.id}</h1>
          <WorkflowStatusBadge status={automationStatus} />
        </div>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Back to Orders
        </Link>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Customer</h2>
        <dl className="space-y-2 text-sm">
          <DetailRow label="Name" value={order.customer_name} />
          <DetailRow label="Phone" value={order.customer_phone} />
          <DetailRow label="City" value={order.customer_city} />
          <DetailRow label="Address" value={order.customer_address} />
        </dl>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Order</h2>
        <dl className="space-y-2 text-sm">
          <DetailRow label="Product" value={order.product} />
          <DetailRow label="Quantity" value={order.quantity} />
          <DetailRow label="Price" value={order.price} />
          <DetailRow label="Total" value={total} />
          <DetailRow label="Status" value={order.status} />
          <DetailRow label="Created" value={new Date(order.created_at).toLocaleString()} />
        </dl>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Shop</h2>
        <dl className="space-y-2 text-sm">
          <DetailRow label="Shop Name" value={order.shops?.name} />
          <DetailRow label="Platform" value={order.shops?.platform} />
        </dl>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Automation</h2>
        {executionsError ? (
          <p className="text-sm text-red-600">Couldn&apos;t load automation status.</p>
        ) : (
          <dl className="space-y-2 text-sm">
            <DetailRow
              label="Automation Status"
              value={
                automationStatus === "none"
                  ? "No workflow has run for this order"
                  : automationStatus === "success"
                    ? "Success"
                    : "Failed"
              }
            />
            <DetailRow
              label="Latest Workflow"
              value={latestExecution?.workflows?.name ?? "-"}
            />
            <DetailRow
              label="Latest Execution"
              value={
                latestExecution
                  ? formatRelativeTime(new Date(latestExecution.started_at as string))
                  : "-"
              }
            />
            <DetailRow
              label="Execution Duration"
              value={
                latestExecution ? formatDuration(latestExecution.duration_ms as number) : "-"
              }
            />
            <DetailRow
              label="Failed Steps"
              value={
                failedSteps.length === 0
                  ? "None"
                  : failedSteps
                      .map((s) => `Step ${s.step_order} (${s.module_name})`)
                      .join(", ")
              }
            />
          </dl>
        )}
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Order Timeline</h2>
        {executionsError ? (
          <p className="text-sm text-red-600">Couldn&apos;t load the order&apos;s automation timeline.</p>
        ) : executions.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((entry) => (
                <TableRow key={entry.id as number}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(entry.started_at as string).toLocaleString()}
                  </TableCell>
                  <TableCell>{entry.workflows?.name ?? "-"}</TableCell>
                  <TableCell>{entry.step_order as number}</TableCell>
                  <TableCell>{entry.module_name as string}</TableCell>
                  <TableCell>
                    <span className={entry.status === "success" ? "text-green-700" : "text-red-700"}>
                      {entry.status === "success" ? "Success" : "Failed"}
                    </span>
                  </TableCell>
                  <TableCell>{formatDuration(entry.duration_ms as number)}</TableCell>
                  <TableCell>{(entry.message as string | null) ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-center text-gray-500">No automation activity yet.</p>
        )}
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Status Timeline</h2>
        {historyError ? (
          <p className="text-sm text-red-600">Couldn&apos;t load status history.</p>
        ) : history && history.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Previous Status</TableHead>
                <TableHead>New Status</TableHead>
                <TableHead>Changed By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history as OrderHistoryEntry[]).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{new Date(entry.created_at).toLocaleString()}</TableCell>
                  <TableCell className="capitalize">{entry.previous_status ?? "-"}</TableCell>
                  <TableCell className="capitalize">{entry.new_status}</TableCell>
                  <TableCell>{user?.email ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-center text-gray-500">No status changes yet.</p>
        )}
      </div>
    </main>
  );
}
