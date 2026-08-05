import { describe, it, expect, vi, beforeEach } from "vitest";

const { getTool } = vi.hoisted(() => ({ getTool: vi.fn() }));

vi.mock("@/lib/agent/tools/registry", () => ({ getTool }));

import { dispatchToolCall } from "@/lib/agent/tools/dispatch";

const context = { shop_id: 15, conversation_id: 1 };
const call = { id: "call_1", name: "check_stock", arguments: { productId: 42 } };

beforeEach(() => {
  getTool.mockReset();
});

describe("dispatchToolCall", () => {
  it("returns a failed AgentToolCall for a name that isn't registered, without throwing", async () => {
    getTool.mockReturnValue(null);

    const result = await dispatchToolCall(call, context);

    expect(result).toEqual({
      id: "call_1",
      name: "check_stock",
      arguments: { productId: 42 },
      status: "failed",
      error: 'Unknown tool "check_stock".',
    });
  });

  it("executes the registered tool and returns a succeeded AgentToolCall with its result", async () => {
    const execute = vi.fn().mockResolvedValue({ inStock: 12 });
    getTool.mockReturnValue({ name: "check_stock", description: "", parameters: {}, execute });

    const result = await dispatchToolCall(call, context);

    expect(execute).toHaveBeenCalledWith({ productId: 42 }, context);
    expect(result).toEqual({
      id: "call_1",
      name: "check_stock",
      arguments: { productId: 42 },
      status: "succeeded",
      result: { inStock: 12 },
    });
  });

  it("returns a failed AgentToolCall, not a rejection, when execute() throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("upstream API down"));
    getTool.mockReturnValue({ name: "check_stock", description: "", parameters: {}, execute });

    const result = await dispatchToolCall(call, context);

    expect(result).toEqual({
      id: "call_1",
      name: "check_stock",
      arguments: { productId: 42 },
      status: "failed",
      error: "upstream API down",
    });
  });

  it("stringifies a non-Error throw rather than losing it", async () => {
    const execute = vi.fn().mockRejectedValue("plain string failure");
    getTool.mockReturnValue({ name: "check_stock", description: "", parameters: {}, execute });

    const result = await dispatchToolCall(call, context);

    expect(result.error).toBe("plain string failure");
  });
});
