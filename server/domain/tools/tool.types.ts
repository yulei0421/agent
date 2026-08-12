export type ToolExecutionResult =
  | { ok: true; name: string; result: Record<string, unknown> | unknown[] }
  | { ok: false; name: string; errorCode: string };

export interface ToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export interface ToolExecutionContext {
  ip?: string;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: 'string'; maxLength: number }>;
      required?: readonly string[];
      additionalProperties: false;
    };
  };
}

export interface ToolManifest {
  name: string;
  version: string;
  riskLevel: 'read_only';
  timeoutMs: number;
  definition: ToolDefinition;
  execute: (call: ToolCall, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

export interface ToolExecutor {
  definitions(): readonly ToolDefinition[];
  execute(call: ToolCall, context?: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export interface ToolManifestRegistry extends ToolExecutor {
  manifests(): readonly ToolManifest[];
}
