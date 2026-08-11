import { Annotation } from '@langchain/langgraph';
import type { AgentSseEvent } from '../types.js';

export type ModelConversationMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: readonly AssistantToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface AssistantToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface PendingToolCall {
  id?: string;
  name?: string;
  arguments: string;
  hasArguments: boolean;
  index: number;
  order: number;
}

export const AgentStateAnnotation = Annotation.Root({
  goal: Annotation<string>({ reducer: (_left, right) => right, default: () => '' }),
  plan: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  currentStep: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  messages: Annotation<ModelConversationMessage[]>({ reducer: (_left, right) => right, default: () => [] }),
  pendingCalls: Annotation<PendingToolCall[]>({ reducer: (_left, right) => right, default: () => [] }),
  toolRounds: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  toolCalls: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  forceFinalAnswer: Annotation<boolean>({ reducer: (_left, right) => right, default: () => false }),
  modelToolsDisabled: Annotation<boolean>({ reducer: (_left, right) => right, default: () => false }),
  resumeModelAfterTools: Annotation<boolean>({ reducer: (_left, right) => right, default: () => false }),
  finalized: Annotation<boolean>({ reducer: (_left, right) => right, default: () => false }),
  terminated: Annotation<boolean>({ reducer: (_left, right) => right, default: () => false }),
  events: Annotation<AgentSseEvent[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
  onEvent: Annotation<((event: AgentSseEvent) => void) | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  signal: Annotation<AbortSignal | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  ip: Annotation<string>({ reducer: (_left, right) => right, default: () => '' }),
  now: Annotation<() => Date>({ reducer: (_left, right) => right, default: () => () => new Date() })
});

export type AgentGraphState = typeof AgentStateAnnotation.State;
export type AgentGraphUpdate = typeof AgentStateAnnotation.Update;

export function normalizePlan(steps: readonly string[]): string[] {
  return steps
    .filter((step) => typeof step === 'string')
    .map((step) => step.trim())
    .filter((step) => step.length > 0 && step.length <= 120)
    .slice(0, 3);
}
