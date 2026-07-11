import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";

const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

import { emailModule } from "@/lib/automation-modules/email";
import type { Order } from "@/types/order";

const baseOrder = {
  id: 1,
  shop_id: 7,
  customer_name: "Amina",
  customer_email: "amina@example.com",
  product: "T-Shirt",
} as Order;

beforeEach(() => {
  getModuleCredentials.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("emailModule.validateConfig", () => {
  it("rejects a missing subject", () => {
    expect(emailModule.validateConfig!({ body: "Hi" })).toMatch(/subject/);
  });

  it("rejects a missing body", () => {
    expect(emailModule.validateConfig!({ subject: "Hi" })).toMatch(/body/);
  });

  it("accepts a valid subject and body", () => {
    expect(emailModule.validateConfig!({ subject: "Order confirmed", body: "Thanks!" })).toBeNull();
  });
});

describe("emailModule.run", () => {
  it("fails cleanly when the order has no shop_id", async () => {
    const result = await emailModule.run(
      { ...baseOrder, shop_id: null },
      { subject: "Hi", body: "Body" },
      {}
    );
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("fails cleanly when the order has no customer_email", async () => {
    const result = await emailModule.run(
      { ...baseOrder, customer_email: null },
      { subject: "Hi", body: "Body" },
      {}
    );
    expect(result).toEqual({ success: false, message: "Order has no customer email address." });
  });

  it("fails cleanly when Email isn't configured for the shop", async () => {
    getModuleCredentials.mockResolvedValue(null);
    const result = await emailModule.run(baseOrder, { subject: "Hi", body: "Body" }, {});
    expect(result).toEqual({ success: false, message: "Email is not configured for this shop." });
  });

  it("sends via Resend with rendered subject/body and returns the message id", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    const fetchMock = mockFetchSequence([{ json: async () => ({ id: "msg_1" }) }]);

    const result = await emailModule.run(
      baseOrder,
      { subject: "Order for {{product}}", body: "Hi {{customer_name}}" },
      {}
    );

    expect(result).toEqual({ success: true, message: "Email sent.", data: { messageId: "msg_1" } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("amina@example.com");
    expect(body.from).toBe("shop@acme.com");
    expect(body.subject).toBe("Order for T-Shirt");
    expect(body.text).toBe("Hi Amina");
  });

  it("reports a structured failure on a non-2xx response", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    mockFetchSequence([{ ok: false, status: 422 }]);

    const result = await emailModule.run(baseOrder, { subject: "Hi", body: "Body" }, {});

    expect(result).toEqual({ success: false, message: "Email request failed (HTTP 422)." });
  });

  it("omits data entirely when the Resend response has no message id", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    mockFetchSequence([{ json: async () => ({}) }]);

    const result = await emailModule.run(baseOrder, { subject: "Hi", body: "Body" }, {});

    expect(result).toEqual({ success: true, message: "Email sent.", data: undefined });
  });

  it("reports a network-error failure without throwing", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await emailModule.run(baseOrder, { subject: "Hi", body: "Body" }, {});

    expect(result).toEqual({ success: false, message: "Email request failed (network error)." });
  });

  it("reports a timeout distinctly from a generic network error", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "re_test", fromAddress: "shop@acme.com" });
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await emailModule.run(baseOrder, { subject: "Hi", body: "Body" }, {});

    expect(result).toEqual({ success: false, message: "Email request timed out." });
  });
});
