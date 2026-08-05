import { getTool } from "./registry";
import type { ChatToolCall } from "@/lib/ai";
import type { AgentToolCall } from "../types";
import type { ToolExecutionContext } from "./types";

// The Tool Dispatcher: resolves one model-requested call to a registered
// ToolDefinition and executes it. Never throws — an unknown tool name (the
// model hallucinating one that was never advertised) and a failing
// execute() both become a failed AgentToolCall, fed back to the model as a
// tool result like any other, rather than aborting the customer's whole
// turn over one bad call. This is the property engine/provider-loop.ts's
// round-trip loop depends on: it can await every dispatch without a
// try/catch of its own.
export async function dispatchToolCall(call: ChatToolCall, context: ToolExecutionContext): Promise<AgentToolCall> {
  const tool = getTool(call.name);

  if (!tool) {
    return {
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      status: "failed",
      error: `Unknown tool "${call.name}".`,
    };
  }

  try {
    const result = await tool.execute(call.arguments, context);
    return { id: call.id, name: call.name, arguments: call.arguments, status: "succeeded", result };
  } catch (err) {
    return {
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
