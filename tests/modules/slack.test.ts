import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";
import { slackModule } from "@/lib/automation-modules/slack";
import { mockedLookup } from "../mocks/dns";
import type { Order } from "@/types/order";

const order = {
  id: 1,
  order_id: "ORD-1",
  customer_name: "Amina",
  product: "T-Shirt",
  status: "confirmed",
} as Order;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

describe("slackModule.validateConfig", () => {
  it("rejects a non-https URL", () => {
    expect(slackModule.validateConfig!({ webhookUrl: "http://hooks.slack.com/x" })).toMatch(
      /valid https webhook URL/
    );
    expect(slackModule.validateConfig!({ webhookUrl: "not-a-url" })).toMatch(
      /valid https webhook URL/
    );
  });

  // Regression-style guard for the SSRF fix: a literal private IP is caught
  // synchronously, at config-save time, before a merchant can even save the
  // step — same rule as the Webhook module.
  it("rejects a URL pointing at a private/internal address", () => {
    expect(
      slackModule.validateConfig!({ webhookUrl: "https://169.254.169.254/steal" })
    ).toMatch(/not allowed/i);
  });

  it("rejects a blank template when one is provided", () => {
    expect(
      slackModule.validateConfig!({ webhookUrl: "https://hooks.slack.com/x", template: "   " })
    ).toMatch(/template/);
  });

  it("accepts a bare https webhook URL (template optional)", () => {
    expect(slackModule.validateConfig!({ webhookUrl: "https://hooks.slack.com/x" })).toBeNull();
  });

  it("accepts a valid webhook URL with a custom template", () => {
    expect(
      slackModule.validateConfig!({
        webhookUrl: "https://hooks.slack.com/x",
        template: "Order {{order_id}} placed",
      })
    ).toBeNull();
  });
});

describe("slackModule.run", () => {
  it("posts the default template as Slack's {text} payload", async () => {
    const fetchMock = mockFetchSequence([{ status: 200, text: async () => "ok" }]);

    const result = await slackModule.run(order, { webhookUrl: "https://hooks.slack.com/x" }, {});

    expect(result).toEqual({ success: true, message: "Slack message sent." });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/x");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe("New order #ORD-1 from Amina — T-Shirt (confirmed).");
  });

  it("renders a custom template", async () => {
    const fetchMock = mockFetchSequence([{ status: 200, text: async () => "ok" }]);

    await slackModule.run(
      order,
      { webhookUrl: "https://hooks.slack.com/x", template: "{{customer_name}} bought {{product}}" },
      {}
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe("Amina bought T-Shirt");
  });

  it("reports success: false on a non-2xx response, with the status/body captured in data", async () => {
    mockFetchSequence([{ ok: false, status: 500, text: async () => "server error" }]);

    const result = await slackModule.run(order, { webhookUrl: "https://hooks.slack.com/x" }, {});

    expect(result.success).toBe(false);
    expect(result.message).toBe("Slack responded with HTTP 500.");
    expect(result.data).toEqual({ statusCode: 500, body: "server error" });
  });

  it("reports a network-error failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS failure")));

    const result = await slackModule.run(order, { webhookUrl: "https://hooks.slack.com/x" }, {});

    expect(result).toEqual({ success: false, message: "Slack request failed (network error)." });
  });

  it("reports a timeout distinctly from a generic network error", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await slackModule.run(order, { webhookUrl: "https://hooks.slack.com/x" }, {});

    expect(result).toEqual({ success: false, message: "Slack request timed out." });
  });

  // Regression-style guard for the SSRF fix: a hostname that resolves (via
  // DNS, not just a literal IP) to a private address is caught here even
  // though it already passed validateConfig() at save time.
  it("never calls fetch() when the URL resolves to a private address", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await slackModule.run(
      order,
      { webhookUrl: "https://internal.example.com/x" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not allowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
