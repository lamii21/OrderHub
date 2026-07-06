"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusSelect } from "@/components/status-select";
import { DetailModal, DetailRow } from "@/components/detail-modal";
import type { Order } from "@/types/order";

export function OrdersTable({ orders }: { orders: Order[] }) {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  return (
    <>
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
              <TableHead>Created At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow
                key={order.id}
                onClick={() => setSelectedOrder(order)}
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

      {selectedOrder && (
        <DetailModal title={`Order #${selectedOrder.id}`} onClose={() => setSelectedOrder(null)}>
          <DetailRow label="Order ID" value={selectedOrder.order_id} />
          <DetailRow label="Customer" value={selectedOrder.customer_name} />
          <DetailRow label="Phone" value={selectedOrder.customer_phone} />
          <DetailRow label="City" value={selectedOrder.customer_city} />
          <DetailRow label="Address" value={selectedOrder.customer_address} />
          <DetailRow label="Product" value={selectedOrder.product} />
          <DetailRow label="Quantity" value={selectedOrder.quantity} />
          <DetailRow label="Price" value={selectedOrder.price} />
          <DetailRow label="Shop" value={selectedOrder.shops?.name} />
          <DetailRow label="Platform" value={selectedOrder.shops?.platform} />
          <DetailRow
            label="Created At"
            value={new Date(selectedOrder.created_at).toLocaleString()}
          />
          <div className="flex items-center justify-between pt-2">
            <dt className="text-gray-500">Status</dt>
            <dd>
              <StatusSelect orderId={selectedOrder.id} status={selectedOrder.status} />
            </dd>
          </div>
        </DetailModal>
      )}
    </>
  );
}
