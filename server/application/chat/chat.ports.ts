import type { ToolExecutor } from '../../domain/tools/tool.types.js';
import type { DeepSeekSseEvent } from '../../sse.js';

export const MODEL_CLIENT = Symbol('MODEL_CLIENT');
export const TOOL_EXECUTOR = Symbol('TOOL_EXECUTOR');

export interface ModelRequest {
  messages: readonly unknown[];
  tools: readonly unknown[];
  forceFinalAnswer?: boolean;
}

export interface ModelClient {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<DeepSeekSseEvent>;
}

export type { ToolExecutor };
