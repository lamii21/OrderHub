// Mirrors lib/ai's ChatProvider/EmbeddingProvider pattern and
// lib/platforms's PlatformConnector before that: an interface a concrete
// tool implements, declared once so the registry and the dispatcher (both
// in this folder) never need to know a specific tool's internals — only
// that every tool shares this shape. `parameters` is a JSON Schema object,
// the same shape lib/ai's ChatTool.parameters already expects — a tool's
// own definition IS what gets advertised to the model, unchanged, via
// registry.ts's getEnabledTools.

export type ToolExecutionContext = {
  shop_id: number;
  conversation_id: number;
  // Resolved once per turn from the conversation itself
  // (AgentConversation.customer_id, Phase 4), never from a tool call's own
  // arguments — a model-supplied customer id would be untrusted input a
  // malicious or confused conversation could use to read another
  // customer's data. null when the conversation isn't linked to an
  // identified customer yet; a tool that needs one must handle that case
  // itself (e.g. by declining to answer) rather than falling back to an
  // unscoped, shop-wide query.
  customer_id: number | null;
};

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}
