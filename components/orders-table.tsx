"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
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

  const openOrder = (orderId: number) => router.push(`/orders/${orderId}`);

  // A row's onClick alone left it unreachable by keyboard — role="button" +
  // tabIndex + onKeyDown make it a real activatable control for Enter/Space,
  // same as clicking it, without turning every TableRow everywhere into a
  // button (only rows that are actually navigable get this).
  const handleRowKeyDown = (orderId: number) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openOrder(orderId);
    }
  };

  return (
    <div className="rounded-lg bg-white">
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
              onClick={() => openOrder(order.id)}
              onKeyDown={handleRowKeyDown(order.id)}
              role="button"
              tabIndex={0}
              aria-label={`Open order for ${order.customer_name ?? "unknown customer"}`}
              className="cursor-pointer"
            >
              <TableCell className="font-medium text-neutral-900">{order.customer_name ?? "—"}</TableCell>
              <TableCell>{order.customer_phone ?? "—"}</TableCell>
              <TableCell>{order.customer_city ?? "—"}</TableCell>
              <TableCell>{order.customer_address ?? "—"}</TableCell>
              <TableCell>{order.product ?? "—"}</TableCell>
              <TableCell>{order.quantity ?? "—"}</TableCell>
              <TableCell>{order.price ?? "—"}</TableCell>
              <TableCell>{order.shops?.name ?? "—"}</TableCell>
              <TableCell>{order.shops?.platform ?? "—"}</TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                <StatusSelect orderId={order.id} status={order.status} />
              </TableCell>
              <TableCell>
                <WorkflowStatusBadge
                  status={workflowStatusByOrderId?.get(order.id) ?? "none"}
                />
              </TableCell>
              <TableCell className="text-neutral-500">{new Date(order.created_at).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {orders.length === 0 && (
        <p className="p-10 text-center text-sm text-neutral-500">
          No orders yet. Once your Google Apps Script sends its first order, it will show up
          here.
        </p>
      )}
    </div>
  );
}
