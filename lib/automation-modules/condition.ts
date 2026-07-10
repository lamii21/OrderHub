import type { AutomationModule } from "./types";

// Control module, stub. Condition's real behavior (see the Automation
// Modules catalog) needs run() to return an outcome beyond success/failed —
// a "stop" state the Execution Engine treats as neither a failure nor a
// green light to keep going. That result-vocabulary extension doesn't
// exist yet (deliberately deferred alongside Delay's "waiting" — the
// catalog is explicit that a 3rd/4th outcome value should be a deliberate
// decision, not an incidental one). Config validation is real: the
// expression shape (field/operator/value) is fully checked even though
// run() can't act on it yet.
type ConditionConfig = { field: string; operator: string; value: unknown };

const ALLOWED_FIELDS = ["price", "quantity", "status", "customer_city", "platform"] as const;
const ALLOWED_OPERATORS = [">", "<", ">=", "<=", "==", "!="] as const;

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

  async run() {
    return {
      success: false,
      message:
        'Condition is not implemented yet — it requires an Execution Engine outcome extension (a "stop" state) not built in this phase.',
    };
  },
};
