import type { ToolExecutor } from '../../domain/tools/tool.types.js';

export const MODEL_CLIENT = Symbol('MODEL_CLIENT');
export const TOOL_EXECUTOR = Symbol('TOOL_EXECUTOR');

export interface ModelClient {
  stream(request: unknown, signal: AbortSignal): AsyncIterable<unknown>;
}

export type { ToolExecutor };
