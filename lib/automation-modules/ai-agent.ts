import type { AutomationModule } from "./types";

// Stub: no LLM provider is connected to this deployment yet. When
// implemented, its structured output (data) is meant to be read by later
// steps via `context` — e.g. a classification consumed by Tag Order or
// Condition — but that only becomes meaningful once run() actually calls a
// model.
type AiAgentConfig = { task: string; confidenceThreshold?: number };

export const aiAgentModule: AutomationModule = {
  validateConfig(config) {
    const { task, confidenceThreshold } = config as Partial<AiAgentConfig>;

    if (typeof task !== "string" || task.trim() === "") {
      return "AI Agent requires a non-empty task description.";
    }

    if (
      confidenceThreshold !== undefined &&
      (typeof confidenceThreshold !== "number" || confidenceThreshold < 0 || confidenceThreshold > 1)
    ) {
      return "AI Agent's confidence threshold must be a number between 0 and 1.";
    }

    return null;
  },

  async run() {
    return {
      success: false,
      message: "AI Agent is not implemented yet — this step is a stub.",
    };
  },
};
