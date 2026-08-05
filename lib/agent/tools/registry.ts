import type { ChatTool } from "@/lib/ai";
import type { ToolDefinition } from "./types";

// Same registry-of-named-modules shape as lib/ai/index.ts's chatProviders/
// embeddingProviders and lib/platforms/index.ts's connector registry. Empty
// today — no business tool has been specified or validated yet (Phase 5
// Étape 8 ships the mechanism only; RAG/product-search tools in particular
// are blocked on lib/ai's EmbeddingProvider, which has no concrete
// implementation yet either). getEnabledTools already resolving real names
// against a real registry — tested with a fake tool — is what makes adding
// the first real one later a pure addition to `tools` below: nothing in
// this file, dispatch.ts, or the engine's provider loop needs to change.
const tools: Record<string, ToolDefinition> = {};

export function getTool(name: string): ToolDefinition | null {
  return tools[name] ?? null;
}

// Resolves a shop's configured tool names (AiAgentConfig.enabled_tools)
// down to the ChatTool[] the provider loop advertises to the model —
// silently drops a name that isn't (or is no longer) registered, since a
// stale or misspelled entry in a shop's config is a data quality issue, not
// a reason to break that shop's whole conversation.
export function getEnabledTools(names: string[]): ChatTool[] {
  return names
    .map((name) => tools[name])
    .filter((tool): tool is ToolDefinition => tool !== undefined)
    .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}
