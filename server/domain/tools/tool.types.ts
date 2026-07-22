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
      required?: string[];
      additionalProperties: false;
    };
  };
}

export interface ToolExecutor {
  definitions(): readonly ToolDefinition[];
  execute(call: ToolCall, context?: ToolExecutionContext): Promise<ToolExecutionResult>;
}
