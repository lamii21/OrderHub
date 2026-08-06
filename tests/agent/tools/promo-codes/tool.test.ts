import { describe, it, expect, vi, beforeEach } from "vitest";

const { checkPromoCodeValidity } = vi.hoisted(() => ({ checkPromoCodeValidity: vi.fn() }));

vi.mock("@/lib/agent/tools/promo-codes/service", () => ({ checkPromoCodeValidity }));

import { checkPromoCodeTool } from "@/lib/agent/tools/promo-codes/tool";

const context = { shop_id: 15, conversation_id: 1, customer_id: null };

beforeEach(() => {
  checkPromoCodeValidity.mockReset();
});

describe("checkPromoCodeTool", () => {
  it("declares a name and a required code parameter", () => {
    expect(checkPromoCodeTool.name).toBe("check_promo_code");
    expect(checkPromoCodeTool.parameters).toMatchObject({
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
    });
  });

  it("passes shop_id from context and the trimmed code to the service", async () => {
    checkPromoCodeValidity.mockResolvedValue({ valid: true, discount_type: "fixed", discount_value: 50 });

    await checkPromoCodeTool.execute({ code: "  WELCOME10  " }, context);

    expect(checkPromoCodeValidity).toHaveBeenCalledWith(15, "WELCOME10");
  });

  it("never requires customer_id — works the same whether or not a customer is identified", async () => {
    checkPromoCodeValidity.mockResolvedValue({ valid: false, reason: "not_found" });

    await checkPromoCodeTool.execute({ code: "WELCOME10" }, { ...context, customer_id: 42 });

    expect(checkPromoCodeValidity).toHaveBeenCalledWith(15, "WELCOME10");
  });

  it("returns an empty-code result without calling the service when code is empty or whitespace-only", async () => {
    const result = await checkPromoCodeTool.execute({ code: "   " }, context);

    expect(result).toEqual({ valid: false, reason: "empty_code" });
    expect(checkPromoCodeValidity).not.toHaveBeenCalled();
  });

  it("returns an empty-code result without calling the service when code isn't a string at all", async () => {
    const result = await checkPromoCodeTool.execute({}, context);

    expect(result).toEqual({ valid: false, reason: "empty_code" });
    expect(checkPromoCodeValidity).not.toHaveBeenCalled();
  });

  it("returns the service's result as-is", async () => {
    const validity = { valid: true as const, discount_type: "percentage" as const, discount_value: 15 };
    checkPromoCodeValidity.mockResolvedValue(validity);

    const result = await checkPromoCodeTool.execute({ code: "WELCOME15" }, context);

    expect(result).toEqual(validity);
  });
});
