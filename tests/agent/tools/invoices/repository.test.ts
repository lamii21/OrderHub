import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../../../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { findInvoiceForOrder, findMostRecentInvoiceForCustomer } from "@/lib/agent/tools/invoices/repository";

const invoiceRow = { id: 123, amount: 350, currency: "USD", issued_at: "2026-08-05T10:00:00.000Z" };

describe("findInvoiceForOrder", () => {
  it("resolves the order's internal id first, scoped by shop_id, customer_id, and order_id", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        orders: { data: { id: 7 }, error: null },
        invoices: { data: invoiceRow, error: null },
      },
    });
    holder.client = client;

    const result = await findInvoiceForOrder(15, 42, "ORD-1001");

    expect(builders.orders[0].select).toHaveBeenCalledWith("id");
    expect(builders.orders[0].eq).toHaveBeenNthCalledWith(1, "shop_id", 15);
    expect(builders.orders[0].eq).toHaveBeenNthCalledWith(2, "customer_id", 42);
    expect(builders.orders[0].eq).toHaveBeenNthCalledWith(3, "order_id", "ORD-1001");
    expect(result).toEqual(invoiceRow);
  });

  it("queries invoices by shop_id, customer_id, and the resolved internal order_id", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        orders: { data: { id: 7 }, error: null },
        invoices: { data: invoiceRow, error: null },
      },
    });
    holder.client = client;

    await findInvoiceForOrder(15, 42, "ORD-1001");

    expect(builders.invoices[0].select).toHaveBeenCalledWith("id, amount, currency, issued_at");
    expect(builders.invoices[0].eq).toHaveBeenNthCalledWith(1, "shop_id", 15);
    expect(builders.invoices[0].eq).toHaveBeenNthCalledWith(2, "customer_id", 42);
    expect(builders.invoices[0].eq).toHaveBeenNthCalledWith(3, "order_id", 7);
  });

  it("returns null and never queries invoices when the order itself isn't found", async () => {
    const { client, builders } = createMockSupabase({
      responses: { orders: { data: null, error: null } },
    });
    holder.client = client;

    const result = await findInvoiceForOrder(15, 42, "does-not-exist");

    expect(result).toBeNull();
    expect(builders.invoices).toBeUndefined();
  });

  it("returns null when the order exists but has no invoice", async () => {
    const { client } = createMockSupabase({
      responses: {
        orders: { data: { id: 7 }, error: null },
        invoices: { data: null, error: null },
      },
    });
    holder.client = client;

    await expect(findInvoiceForOrder(15, 42, "ORD-1001")).resolves.toBeNull();
  });

  it("throws on an order lookup error", async () => {
    const { client } = createMockSupabase({
      responses: { orders: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(findInvoiceForOrder(15, 42, "ORD-1001")).rejects.toThrow("db down");
  });

  it("throws on an invoice lookup error", async () => {
    const { client } = createMockSupabase({
      responses: {
        orders: { data: { id: 7 }, error: null },
        invoices: { data: null, error: { message: "db down" } },
      },
    });
    holder.client = client;

    await expect(findInvoiceForOrder(15, 42, "ORD-1001")).rejects.toThrow("db down");
  });
});

describe("findMostRecentInvoiceForCustomer", () => {
  it("scopes by shop_id and customer_id, ordered newest-first, limited to one", async () => {
    const { client, builders } = createMockSupabase({
      responses: { invoices: { data: invoiceRow, error: null } },
    });
    holder.client = client;

    const result = await findMostRecentInvoiceForCustomer(15, 42);

    expect(builders.invoices[0].eq).toHaveBeenNthCalledWith(1, "shop_id", 15);
    expect(builders.invoices[0].eq).toHaveBeenNthCalledWith(2, "customer_id", 42);
    expect(builders.invoices[0].order).toHaveBeenCalledWith("issued_at", { ascending: false });
    expect(builders.invoices[0].limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(invoiceRow);
  });

  it("returns null when the customer has no invoices", async () => {
    const { client } = createMockSupabase({ responses: { invoices: { data: null, error: null } } });
    holder.client = client;

    await expect(findMostRecentInvoiceForCustomer(15, 42)).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { invoices: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(findMostRecentInvoiceForCustomer(15, 42)).rejects.toThrow("db down");
  });
});
