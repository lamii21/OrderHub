import { describe, it, expect } from "vitest";
import { slackModule } from "@/lib/automation-modules/slack";
import { erpModule } from "@/lib/automation-modules/erp";
import { crmModule } from "@/lib/automation-modules/crm";
import { smsModule } from "@/lib/automation-modules/sms";
import { aiAgentModule } from "@/lib/automation-modules/ai-agent";
import { delayModule } from "@/lib/automation-modules/delay";
import { conditionModule } from "@/lib/automation-modules/condition";
import type { Order } from "@/types/order";

const order = { id: 1, customer_phone: "0600000000" } as Order;

// The 7 modules with no external provider connected yet (Slack/ERP/CRM/SMS/
// AI Agent), plus the 2 control modules whose real behavior needs an
// Execution Engine outcome-vocabulary extension not built yet (Delay/
// Condition). Every one of them still validates its config for real — only
// run() is a placeholder. See lib/automation-modules/index.ts's own comment.

describe("slackModule (stub)", () => {
  it("validates a real https webhook URL", () => {
    expect(slackModule.validateConfig!({ webhookUrl: "https://hooks.slack.com/x" })).toBeNull();
    expect(slackModule.validateConfig!({ webhookUrl: "not-a-url" })).not.toBeNull();
    expect(slackModule.validateConfig!({ webhookUrl: "http://insecure.example.com" })).not.toBeNull();
  });

  it("run() honestly reports it is not implemented", async () => {
    const result = await slackModule.run(order, { webhookUrl: "https://hooks.slack.com/x" }, {});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not implemented yet/);
  });
});

describe("erpModule (stub)", () => {
  it("validates a real endpoint URL", () => {
    expect(erpModule.validateConfig!({ endpoint: "https://erp.example.com/api" })).toBeNull();
    expect(erpModule.validateConfig!({ endpoint: "" })).not.toBeNull();
  });

  it("run() honestly reports it is not implemented", async () => {
    const result = await erpModule.run(order, { endpoint: "https://erp.example.com" }, {});
    expect(result).toEqual({ success: false, message: "ERP is not implemented yet — this step is a stub." });
  });
});

describe("crmModule (stub)", () => {
  it("requires a non-empty provider name", () => {
    expect(crmModule.validateConfig!({ provider: "hubspot" })).toBeNull();
    expect(crmModule.validateConfig!({ provider: "" })).not.toBeNull();
    expect(crmModule.validateConfig!({})).not.toBeNull();
  });

  it("run() honestly reports it is not implemented", async () => {
    const result = await crmModule.run(order, { provider: "hubspot" }, {});
    expect(result.success).toBe(false);
  });
});

describe("smsModule (stub)", () => {
  it("requires a non-empty template", () => {
    expect(smsModule.validateConfig!({ template: "Hi {{customer_name}}" })).toBeNull();
    expect(smsModule.validateConfig!({ template: "" })).not.toBeNull();
  });

  it("still fails cleanly on a missing phone number before reaching the stub message", async () => {
    const result = await smsModule.run({ ...order, customer_phone: null }, { template: "Hi" }, {});
    expect(result).toEqual({ success: false, message: "Order has no customer phone number." });
  });

  it("run() honestly reports it is not implemented when a phone number is present", async () => {
    const result = await smsModule.run(order, { template: "Hi" }, {});
    expect(result.message).toMatch(/not implemented yet/);
  });
});

describe("aiAgentModule (stub)", () => {
  it("requires a non-empty task", () => {
    expect(aiAgentModule.validateConfig!({ task: "Classify this order" })).toBeNull();
    expect(aiAgentModule.validateConfig!({ task: "" })).not.toBeNull();
  });

  it("validates an optional confidenceThreshold is between 0 and 1", () => {
    expect(aiAgentModule.validateConfig!({ task: "x", confidenceThreshold: 0.8 })).toBeNull();
    expect(aiAgentModule.validateConfig!({ task: "x", confidenceThreshold: 1.5 })).not.toBeNull();
    expect(aiAgentModule.validateConfig!({ task: "x", confidenceThreshold: -0.1 })).not.toBeNull();
  });

  it("run() honestly reports it is not implemented", async () => {
    const result = await aiAgentModule.run(order, { task: "Classify" }, {});
    expect(result.success).toBe(false);
  });
});

describe("delayModule (stub control module)", () => {
  it("accepts simple durations like 30m/2h/1d", () => {
    expect(delayModule.validateConfig!({ duration: "30m" })).toBeNull();
    expect(delayModule.validateConfig!({ duration: "2h" })).toBeNull();
    expect(delayModule.validateConfig!({ duration: "1d" })).toBeNull();
  });

  it("rejects a duration with no unit or an unsupported unit", () => {
    expect(delayModule.validateConfig!({ duration: "30" })).not.toBeNull();
    expect(delayModule.validateConfig!({ duration: "1w" })).not.toBeNull();
  });

  it("run() reports the specific Execution Engine gap (waiting outcome), not a generic stub message", async () => {
    const result = await delayModule.run(order, { duration: "1h" }, {});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/waiting/);
  });
});

describe("conditionModule (stub control module)", () => {
  it("accepts a field/operator/value from the allowed whitelist", () => {
    expect(
      conditionModule.validateConfig!({ field: "price", operator: ">", value: 100 })
    ).toBeNull();
  });

  it("rejects a field outside the whitelist", () => {
    expect(
      conditionModule.validateConfig!({ field: "secret_column", operator: "==", value: 1 })
    ).toMatch(/field must be one of/);
  });

  it("rejects an unsupported operator", () => {
    expect(
      conditionModule.validateConfig!({ field: "price", operator: "~=", value: 1 })
    ).toMatch(/operator must be one of/);
  });

  it("rejects a missing comparison value", () => {
    expect(conditionModule.validateConfig!({ field: "price", operator: ">", value: "" })).toMatch(
      /comparison value/
    );
  });

  it("run() reports the specific Execution Engine gap (stop outcome), not a generic stub message", async () => {
    const result = await conditionModule.run(order, { field: "price", operator: ">", value: 100 }, {});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/stop/);
  });
});
