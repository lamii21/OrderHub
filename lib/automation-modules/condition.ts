import type { AutomationModule } from "./types";
import type { Order } from "@/types/order";

// Control module. Evaluates a field/operator/value expression against the
// order and reports a "stop" outcome when it's false — the Execution
// Engine vocabulary extension this module was blocked on has since landed
// (see ModuleResult.outcome in ./types.ts): runWorkflow() now halts the
// rest of this workflow run and records the step as a successful,
// deliberate exit rather than a failure. A true expression continues the
// workflow exactly like any other successful step (no outcome set).
type ConditionConfig = { field: string; operator: string; value: unknown };

const ALLOWED_FIELDS = ["price", "quantity", "status", "customer_city", "platform"] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];
const ALLOWED_OPERATORS = [">", "<", ">=", "<=", "==", "!="] as const;
type AllowedOperator = (typeof ALLOWED_OPERATORS)[number];

function readField(order: Order, field: AllowedField): string | number | null {
  switch (field) {
    case "price":
      return order.price;
    case "quantity":
      return order.quantity;
    case "status":
      return order.status;
    case "customer_city":
      return order.customer_city;
    case "platform":
      return order.shops?.platform ?? null;
  }
}

// A missing field (null) never satisfies any comparison — there's nothing
// to compare against, so the condition is false rather than throwing.
// ">"/"<"/">="/"<=" always compare numerically (a non-numeric value on
// either side makes the comparison false, not an error); "=="/"!=" compare
// as strings so a numeric field (price: 199) still matches a
// merchant-entered "199".
function evaluate(actual: string | number | null, operator: AllowedOperator, expected: unknown): boolean {
  if (actual === null) {
    return false;
  }

  if (operator === ">" || operator === "<" || operator === ">=" || operator === "<=") {
    const actualNum = typeof actual === "number" ? actual : Number(actual);
    const expectedNum = Number(expected);
    if (Number.isNaN(actualNum) || Number.isNaN(expectedNum)) {
      return false;
    }
    if (operator === ">") return actualNum > expectedNum;
    if (operator === "<") return actualNum < expectedNum;
    if (operator === ">=") return actualNum >= expectedNum;
    return actualNum <= expectedNum;
  }

  const matches = String(actual) === String(expected);
  return operator === "==" ? matches : !matches;
}

export const conditionModule: AutomationModule = {
  validateConfig(config) {
    const { field, operator, value } = config as Partial<ConditionConfig>;

    if (typeof field !== "string" || !(ALLOWED_FIELDS as readonly string[]).includes(field)) {
      return `Condition's field must be one of: ${ALLOWED_FIELDS.join(", ")}.`;
    }

    if (typeof operator !== "string" || !(ALLOWED_OPERATORS as readonly string[]).includes(operator)) {
      return `Condition's operator must be one of: ${ALLOWED_OPERATORS.join(", ")}.`;
    }

    if (value === undefined || value === null || value === "") {
      return "Condition requires a comparison value.";
    }

    return null;
  },

  async run(order, config) {
    const { field, operator, value } = config as ConditionConfig;

    // Defensive re-check, same reasoning as update-status.ts/tag-order.ts:
    // a saved step's config can only be trusted as far as validateConfig()
    // was actually run against it.
    if (!(ALLOWED_FIELDS as readonly string[]).includes(field)) {
      return { success: false, message: `Condition's field must be one of: ${ALLOWED_FIELDS.join(", ")}.` };
    }
    if (!(ALLOWED_OPERATORS as readonly string[]).includes(operator)) {
      return { success: false, message: `Condition's operator must be one of: ${ALLOWED_OPERATORS.join(", ")}.` };
    }

    const actual = readField(order, field as AllowedField);
    const matches = evaluate(actual, operator as AllowedOperator, value);

    if (matches) {
      return {
        success: true,
        message: `Condition met (${field} ${operator} ${String(value)}) — continuing.`,
      };
    }

    return {
      success: true,
      outcome: "stop",
      message: `Condition not met (${field} ${operator} ${String(value)}) — workflow stopped.`,
    };
  },
};
