import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockFetchSequence } from "../mocks/fetch";

const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));
vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

import { aiAgentModule } from "@/lib/automation-modules/ai-agent";
import type { Order } from "@/types/order";

const baseOrder = {
  id: 1,
  shop_id: 7,
  customer_name: "Amina",
  product: "T-Shirt",
  status: "confirmed",
} as Order;

beforeEach(() => {
  getModuleCredentials.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aiAgentModule.validateConfig", () => {
  it("requires a non-empty task", () => {
    expect(aiAgentModule.validateConfig!({ task: "Classify this order" })).toBeNull();
    expect(aiAgentModule.validateConfig!({ task: "" })).not.toBeNull();
  });

  it("validates an optional confidenceThreshold is between 0 and 1", () => {
    expect(aiAgentModule.validateConfig!({ task: "x", confidenceThreshold: 0.8 })).toBeNull();
    expect(aiAgentModule.validateConfig!({ task: "x", confidenceThreshold: 1.5 })).not.toBeNull();
    expect(aiAgentModule.validateConfig!({ task: "x", confidenceThreshold: -0.1 })).not.toBeNull();
  });
});

describe("aiAgentModule.run", () => {
  it("fails cleanly when the order has no shop", async () => {
    const result = await aiAgentModule.run({ ...baseOrder, shop_id: null }, { task: "Classify" }, {});
    expect(result).toEqual({ success: false, message: "Order has no associated shop." });
  });

  it("fails cleanly when no credentials are configured for the shop", async () => {
    getModuleCredentials.mockResolvedValue(null);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result).toEqual({ success: false, message: "AI Agent is not configured for this shop." });
  });

  it("calls the Anthropic Messages API and returns the parsed result/confidence", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    const fetchMock = mockFetchSequence([
      {
        json: async () => ({
          content: [{ type: "text", text: '{"result": "vip", "confidence": 0.92}' }],
        }),
      },
    ]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify this customer" }, {});

    expect(result).toEqual({
      success: true,
      message: "AI Agent completed.",
      data: { result: "vip", confidence: 0.92 },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-1");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-x");
    expect(body.messages[0].content).toContain("Classify this customer");
    expect(body.messages[0].content).toContain('"customer_name":"Amina"');
  });

  it("extracts a JSON object even when the model wraps it in prose", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    mockFetchSequence([
      {
        json: async () => ({
          content: [
            { type: "text", text: 'Sure, here you go:\n{"result": "urgent", "confidence": 0.6}\nHope that helps!' },
          ],
        }),
      },
    ]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result.data).toEqual({ result: "urgent", confidence: 0.6 });
  });

  it("falls back to the raw text when the response isn't valid JSON", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    mockFetchSequence([{ json: async () => ({ content: [{ type: "text", text: "just plain text" }] }) }]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result).toEqual({
      success: true,
      message: "AI Agent completed.",
      data: { result: "just plain text" },
    });
  });

  it("falls back to the raw text when the matched JSON's result field isn't a string", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    mockFetchSequence([{ json: async () => ({ content: [{ type: "text", text: '{"result": 42}' }] }) }]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result.data).toEqual({ result: '{"result": 42}' });
  });

  it("omits confidence from data when the JSON reply doesn't include one", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    mockFetchSequence([{ json: async () => ({ content: [{ type: "text", text: '{"result": "vip"}' }] }) }]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result).toEqual({ success: true, message: "AI Agent completed.", data: { result: "vip" } });
  });

  it("stops the workflow when confidence is below the configured threshold", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    mockFetchSequence([
      { json: async () => ({ content: [{ type: "text", text: '{"result": "maybe", "confidence": 0.3}' }] }) },
    ]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify", confidenceThreshold: 0.7 }, {});

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("stop");
    expect(result.message).toMatch(/confidence 0\.3 is below the required threshold 0\.7/);
    expect(result.data).toEqual({ result: "maybe", confidence: 0.3 });
  });

  it("continues normally when confidence meets the configured threshold", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    mockFetchSequence([
      { json: async () => ({ content: [{ type: "text", text: '{"result": "ok", "confidence": 0.9}' }] }) },
    ]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify", confidenceThreshold: 0.7 }, {});

    expect(result.outcome).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("reports a structured failure on a non-2xx API response", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    mockFetchSequence([{ ok: false, status: 401 }]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result).toEqual({ success: false, message: "AI Agent request failed (HTTP 401)." });
  });

  it("reports a structured failure when the model returns no text block", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    mockFetchSequence([{ json: async () => ({ content: [] }) }]);

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result).toEqual({ success: false, message: "AI Agent returned no text response." });
  });

  it("reports a network-error failure without throwing", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result).toEqual({ success: false, message: "AI Agent request failed (network error)." });
  });

  it("reports a timeout distinctly from a generic network error", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-ant-1", model: "claude-x" });
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await aiAgentModule.run(baseOrder, { task: "Classify" }, {});

    expect(result).toEqual({ success: false, message: "AI Agent request timed out." });
  });
});
