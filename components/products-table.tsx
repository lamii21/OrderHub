"use client";

import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DetailModal, DetailRow } from "@/components/detail-modal";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@/types/product";

// Surfaces stock at a glance (out of stock must be immediately visible,
// per the Phase 5 brief) without inventing a new status enum — this is a
// pure presentation bucket over the existing stock_quantity number.
function StockBadge({ quantity }: { quantity: number | string | null }) {
  if (quantity === null) {
    return <Badge tone="neutral">Not tracked</Badge>;
  }
  const n = Number(quantity);
  if (n <= 0) {
    return <Badge tone="danger">Out of stock</Badge>;
  }
  if (n <= 5) {
    return <Badge tone="warning">Low · {n}</Badge>;
  }
  return <Badge tone="success">{n} in stock</Badge>;
}

export function ProductsTable({ products }: { products: Product[] }) {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const handleRowKeyDown = (product: Product) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedProduct(product);
    }
  };

  return (
    <>
      <div className="rounded-lg bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Current Price</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Total Orders</TableHead>
              <TableHead>Total Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                onKeyDown={handleRowKeyDown(product)}
                role="button"
                tabIndex={0}
                aria-label={`View details for ${product.name}`}
                className="cursor-pointer"
              >
                <TableCell className="font-medium text-neutral-900">{product.name}</TableCell>
                <TableCell>{product.sku ?? "—"}</TableCell>
                <TableCell>{product.shop_name ?? "—"}</TableCell>
                <TableCell>{product.platform ?? "—"}</TableCell>
                <TableCell>{product.price ?? "—"}</TableCell>
                <TableCell>
                  <StockBadge quantity={product.stock_quantity} />
                </TableCell>
                <TableCell>{Number(product.total_orders)}</TableCell>
                <TableCell>{Number(product.total_revenue).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {products.length === 0 && (
          <p className="p-10 text-center text-sm text-neutral-500">
            No products yet. Add sample rows to the products table, or connect a Shopify store
            and sync products.
          </p>
        )}
      </div>

      {selectedProduct && (
        <DetailModal title={selectedProduct.name} onClose={() => setSelectedProduct(null)}>
          <DetailRow label="Name" value={selectedProduct.name} />
          <DetailRow label="SKU" value={selectedProduct.sku} />
          <DetailRow label="Description" value={selectedProduct.description} />
          <DetailRow label="Price" value={selectedProduct.price} />
          <DetailRow label="Stock" value={selectedProduct.stock_quantity} />
          <DetailRow label="Shop" value={selectedProduct.shop_name} />
          <DetailRow label="Platform" value={selectedProduct.platform} />
          <DetailRow label="Total Sales" value={Number(selectedProduct.total_orders)} />
          <DetailRow label="Revenue" value={Number(selectedProduct.total_revenue).toFixed(2)} />
        </DetailModal>
      )}
    </>
  );
}
