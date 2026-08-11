import { describe, it, expect, vi, beforeEach } from "vitest";

const { getInvoiceForCustomer } = vi.hoisted(() => ({ getInvoiceForCustomer: vi.fn() }));

vi.mock("@/lib/agent/tools/invoices/service", () => ({ getInvoiceForCustomer }));

import { getInvoiceTool } from "@/lib/agent/tools/invoices/tool";

const invoice = { invoice_number: "INV-000123", amount: 350, currency: "USD", issued_at: "2026-08-05T10:00:00.000Z" };

beforeEach(() => {
  getInvoiceForCustomer.mockReset();
});

describe("getInvoiceTool", () => {
  it("declares a name and a parameters schema with an optional order_id", () => {
    expect(getInvoiceTool.name).toBe("get_invoice");
    expect(getInvoiceTool.parameters).toMatchObject({
      type: "object",
      properties: { order_id: { type: "string" } },
    });
  });

  it("declines to answer, without ever calling the service, when the conversation has no identified customer", async () => {
    const result = await getInvoiceTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: null });

    expect(result).toEqual({ found: false, reason: "no_customer_identified" });
    expect(getInvoiceForCustomer).not.toHaveBeenCalled();
  });

  it("passes shop_id and the resolved customer_id from context, never from args", async () => {
    getInvoiceForCustomer.mockResolvedValue({ found: true, invoice });

    await getInvoiceTool.execute(
      { order_id: "ORD-1001", customer_id: 999 },
      { shop_id: 15, conversation_id: 1, customer_id: 42 }
    );

    expect(getInvoiceForCustomer).toHaveBeenCalledWith(15, 42, "ORD-1001");
  });

  it("omits order_id when the argument isn't a string", async () => {
    getInvoiceForCustomer.mockResolvedValue({ found: false });

    await getInvoiceTool.execute({ order_id: 1001 }, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(getInvoiceForCustomer).toHaveBeenCalledWith(15, 42, undefined);
  });

  it("returns the found invoice as-is", async () => {
    getInvoiceForCustomer.mockResolvedValue({ found: true, invoice });

    const result = await getInvoiceTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(result).toEqual({ found: true, invoice });
  });

  it("returns a not_found reason when the service finds nothing", async () => {
    getInvoiceForCustomer.mockResolvedValue({ found: false });

    const result = await getInvoiceTool.execute({}, { shop_id: 15, conversation_id: 1, customer_id: 42 });

    expect(result).toEqual({ found: false, reason: "not_found" });
  });
});
