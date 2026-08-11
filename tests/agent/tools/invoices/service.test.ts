import { describe, it, expect, vi, beforeEach } from "vitest";

const { findInvoiceForOrder, findMostRecentInvoiceForCustomer } = vi.hoisted(() => ({
  findInvoiceForOrder: vi.fn(),
  findMostRecentInvoiceForCustomer: vi.fn(),
}));

vi.mock("@/lib/agent/tools/invoices/repository", () => ({ findInvoiceForOrder, findMostRecentInvoiceForCustomer }));

import { getInvoiceForCustomer } from "@/lib/agent/tools/invoices/service";

const invoiceRow = { id: 123, amount: 350, currency: "USD", issued_at: "2026-08-05T10:00:00.000Z" };

beforeEach(() => {
  findInvoiceForOrder.mockReset();
  findMostRecentInvoiceForCustomer.mockReset();
});

describe("getInvoiceForCustomer", () => {
  it("looks up by order_id when one is given", async () => {
    findInvoiceForOrder.mockResolvedValue(invoiceRow);

    const result = await getInvoiceForCustomer(15, 42, "ORD-1001");

    expect(findInvoiceForOrder).toHaveBeenCalledWith(15, 42, "ORD-1001");
    expect(findMostRecentInvoiceForCustomer).not.toHaveBeenCalled();
    expect(result).toEqual({
      found: true,
      invoice: { invoice_number: "INV-000123", amount: 350, currency: "USD", issued_at: "2026-08-05T10:00:00.000Z" },
    });
  });

  it("falls back to the most recent invoice when no order_id is given", async () => {
    findMostRecentInvoiceForCustomer.mockResolvedValue(invoiceRow);

    const result = await getInvoiceForCustomer(15, 42);

    expect(findMostRecentInvoiceForCustomer).toHaveBeenCalledWith(15, 42);
    expect(findInvoiceForOrder).not.toHaveBeenCalled();
    expect(result.found).toBe(true);
  });

  it("never returns the raw internal id, only the derived invoice_number", async () => {
    findInvoiceForOrder.mockResolvedValue(invoiceRow);

    const result = await getInvoiceForCustomer(15, 42, "ORD-1001");

    expect(result).toEqual({
      found: true,
      invoice: expect.not.objectContaining({ id: expect.anything() }),
    });
  });

  it("pads the invoice number to 6 digits", async () => {
    findInvoiceForOrder.mockResolvedValue({ ...invoiceRow, id: 7 });

    const result = await getInvoiceForCustomer(15, 42, "ORD-1001");

    expect(result).toEqual(expect.objectContaining({ invoice: expect.objectContaining({ invoice_number: "INV-000007" }) }));
  });

  it("returns found: false when nothing matches, by order_id", async () => {
    findInvoiceForOrder.mockResolvedValue(null);
    await expect(getInvoiceForCustomer(15, 42, "does-not-exist")).resolves.toEqual({ found: false });
  });

  it("returns found: false when nothing matches, with no order_id", async () => {
    findMostRecentInvoiceForCustomer.mockResolvedValue(null);
    await expect(getInvoiceForCustomer(15, 42)).resolves.toEqual({ found: false });
  });
});
