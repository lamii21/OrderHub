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
import { DetailModal, DetailRow } from "@/components/detail-modal";
import type { Product } from "@/types/product";

export function ProductsTable({ products }: { products: Product[] }) {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  return (
    <>
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Current Price</TableHead>
              <TableHead>Stock Quantity</TableHead>
              <TableHead>Total Orders</TableHead>
              <TableHead>Total Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className="cursor-pointer"
              >
                <TableCell>{product.name}</TableCell>
                <TableCell>{product.sku ?? "-"}</TableCell>
                <TableCell>{product.shop_name ?? "-"}</TableCell>
                <TableCell>{product.platform ?? "-"}</TableCell>
                <TableCell>{product.price ?? "-"}</TableCell>
                <TableCell>{product.stock_quantity ?? "-"}</TableCell>
                <TableCell>{Number(product.total_orders)}</TableCell>
                <TableCell>{Number(product.total_revenue).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {products.length === 0 && (
          <p className="p-6 text-center text-gray-500">
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
