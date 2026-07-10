"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusSelect } from "@/components/status-select";
import { WorkflowStatusBadge, type OrderAutomationStatus } from "@/components/workflow-status-badge";
import type { Order } from "@/types/order";

export function OrdersTable({
  orders,
  workflowStatusByOrderId,
}: {
  orders: Order[];
  // Optional: callers that haven't fetched workflow execution status (none
  // today — the Dashboard always passes it) still render correctly, just
  // showing "No Automation" for every row instead of omitting the column.
  workflowStatusByOrderId?: Map<number, OrderAutomationStatus>;
}) {
  const router = useRouter();

  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Shop</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Workflow</TableHead>
            <TableHead>Created At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.id}
              onClick={() => router.push(`/orders/${order.id}`)}
              className="cursor-pointer"
            >
              <TableCell>{order.customer_name ?? "-"}</TableCell>
              <TableCell>{order.customer_phone ?? "-"}</TableCell>
              <TableCell>{order.customer_city ?? "-"}</TableCell>
              <TableCell>{order.customer_address ?? "-"}</TableCell>
              <TableCell>{order.product ?? "-"}</TableCell>
              <TableCell>{order.quantity ?? "-"}</TableCell>
              <TableCell>{order.price ?? "-"}</TableCell>
              <TableCell>{order.shops?.name ?? "-"}</TableCell>
              <TableCell>{order.shops?.platform ?? "-"}</TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                <StatusSelect orderId={order.id} status={order.status} />
              </TableCell>
              <TableCell>
                <WorkflowStatusBadge
                  status={workflowStatusByOrderId?.get(order.id) ?? "none"}
                />
              </TableCell>
              <TableCell>{new Date(order.created_at).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {orders.length === 0 && (
        <p className="p-6 text-center text-gray-500">
          No orders yet. Once your Google Apps Script sends its first order, it will show up
          here.
        </p>
      )}
    </div>
  );
}
