import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { createMockSupabase } from "../mocks/supabase";

const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { invoiceModule } from "@/lib/automation-modules/invoice";
import type { Order } from "@/types/order";

const baseOrder = {
  id: 1,
  shop_id: 7,
  customer_id: 42,
  customer_name: "Amina",
  customer_email: "amina@example.com",
  customer_address: "1 Rue X",
  customer_city: "Rabat",
  product: "T-Shirt",
  quantity: 2,
  price: 19.99,
} as Order;

beforeEach(() => {
  getModuleCredentials.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invoiceModule.validateConfig", () => {
  it("accepts no config at all", () => {
    expect(invoiceModule.validateConfig!({})).toBeNull();
  });

  it("accepts a valid footerNote", () => {
    expect(invoiceModule.validateConfig!({ footerNote: "Thank you!" })).toBeNull();
  });

  it("rejects an overly long footerNote", () => {
    expect(invoiceModule.validateConfig!({ footerNote: "x".repeat(501) })).toMatch(/footerNote/);
  });
});

describe("invoiceModule.run", () => {
  it("fails cleanly when the order has no shop", async () => {
    const result = await invoiceModule.run({ ...baseOrder, shop_id: null }, {}, {});
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("fails cleanly when the order has no customer email", async () => {
    const result = await invoiceModule.run({ ...baseOrder, customer_email: null }, {}, {});
    expect(result).toEqual({ success: false, message: "Order has no customer email address." });
  });

  it("fails cleanly when price or quantity is missing", async () => {
    const result = await invoiceModule.run({ ...baseOrder, price: null }, {}, {});
    expect(result).toEqual({ success: false, message: "Order is missing a price or quantity." });
  });

  it("fails cleanly when Email isn't configured for the shop", async () => {
    getModuleCredentials.mockResolvedValue(null);
    const result = await invoiceModule.run(baseOrder, {}, {});
    expect(result).toEqual({ success: false, message: "Email is not configured for this shop." });
  });

  it("creates an invoice record, sends the HTML email, and returns the invoice number", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    const { client, builders } = createMockSupabase({
      responses: {
        shops: { data: { name: "Acme", currency: "USD" }, error: null },
        invoices: { data: { id: 123 }, error: null },
      },
    });
    holder.client = client;
    const fetchMock = mockFetchSequence([{ json: async () => ({ id: "msg_1" }) }]);

    const result = await invoiceModule.run(baseOrder, { footerNote: "Thanks for your order!" }, {});

    expect(result).toEqual({
      success: true,
      message: "Invoice INV-000123 sent.",
      data: { invoiceNumber: "INV-000123", invoiceAmount: 39.98 },
    });

    expect(builders.invoices[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: 7, order_id: 1, customer_id: 42, amount: 39.98, currency: "USD" })
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("amina@example.com");
    expect(body.subject).toBe("Invoice INV-000123");
    expect(body.html).toContain("INV-000123");
    expect(body.html).toContain("Thanks for your order!");
    expect(body.html).toContain("T-Shirt");
  });

  it("escapes HTML-unsafe characters in customer/product fields", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    const { client } = createMockSupabase({
      responses: {
        shops: { data: { name: "Acme", currency: "USD" }, error: null },
        invoices: { data: { id: 1 }, error: null },
      },
    });
    holder.client = client;
    const fetchMock = mockFetchSequence([{ json: async () => ({ id: "msg_1" }) }]);

    await invoiceModule.run({ ...baseOrder, customer_name: "<script>alert(1)</script>" }, {}, {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("reports a structured failure when creating the invoice record fails", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    const { client } = createMockSupabase({
      responses: {
        shops: { data: { name: "Acme", currency: "USD" }, error: null },
        invoices: { data: null, error: { message: "insert failed" } },
      },
    });
    holder.client = client;

    const result = await invoiceModule.run(baseOrder, {}, {});

    expect(result).toEqual({ success: false, message: "Could not create the invoice." });
  });

  it("reports a structured failure when the email itself fails", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    const { client } = createMockSupabase({
      responses: {
        shops: { data: { name: "Acme", currency: "USD" }, error: null },
        invoices: { data: { id: 1 }, error: null },
      },
    });
    holder.client = client;
    mockFetchSequence([{ ok: false, status: 500 }]);

    const result = await invoiceModule.run(baseOrder, {}, {});

    expect(result).toEqual({ success: false, message: "Invoice email failed (HTTP 500)." });
  });

  it("defaults to USD when the shop row can't be found", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    const { client, builders } = createMockSupabase({
      responses: {
        shops: { data: null, error: null },
        invoices: { data: { id: 1 }, error: null },
      },
    });
    holder.client = client;
    mockFetchSequence([{ json: async () => ({ id: "msg_1" }) }]);

    await invoiceModule.run(baseOrder, {}, {});

    expect(builders.invoices[0].insert).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD" })
    );
  });
});
