import type { ToolExecutor } from '../../domain/tools/tool.types.js';
import type { DeepSeekSseEvent } from '../../sse.js';
import type { AgentSseEvent } from '../../types.js';

export const MODEL_CLIENT = Symbol('MODEL_CLIENT');
export const TOOL_EXECUTOR = Symbol('TOOL_EXECUTOR');
export const PLANNER = Symbol('PLANNER');
export const AGENT_RUNNER = Symbol('AGENT_RUNNER');

export type Planner = (goal: string, signal?: AbortSignal) => Promise<readonly string[]>;

export type ModelTaskType = 'fast' | 'reasoning' | 'structured';

export type JsonObjectResponseFormat = { type: 'json_object' };

export interface ModelRequest {
  messages: readonly unknown[];
  tools: readonly unknown[];
  taskType?: ModelTaskType;
  forceFinalAnswer?: boolean;
  responseFormat?: JsonObjectResponseFormat;
}

export interface ModelClient {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<DeepSeekSseEvent>;
}

export type ModelConversationMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: readonly AssistantToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface AssistantToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AgentRunRequest {
  goal: string;
  messages: readonly ModelConversationMessage[];
  responseFormat?: JsonObjectResponseFormat;
  signal: AbortSignal;
  onEvent?: (event: AgentSseEvent) => void;
  ip: string;
  now: () => Date;
  collaboration?: 'research';
  review?: boolean;
  taskType?: ModelTaskType;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<readonly AgentSseEvent[]>;
}

export type { AgentSseEvent, ToolExecutor };
