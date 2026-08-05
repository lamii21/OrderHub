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
};

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}
