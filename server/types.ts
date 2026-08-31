import type { AgentCollaborationEvent, AgentPlanSnapshot } from '../shared/agent-events.js';

export type ToolExecutionResult =
  | { ok: true; name: string; result: Record<string, unknown> | unknown[] }
  | { ok: false; name: string; errorCode: string };

export interface ToolCall {
  id?: string;
  name: string;
  arguments: string;
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

export interface ToolExecutionContext {
  ip?: string;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface ToolRegistry {
  definitions(): readonly ToolDefinition[];
  execute(call: ToolCall, context?: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export type AgentSseEvent =
  | { type: 'delta' | 'reasoning'; content: string }
  | { type: 'task'; id: string; status: 'running' | 'completed' | 'failed' | 'cancelled' }
  | ({ type: 'plan' } & AgentPlanSnapshot)
  | AgentCollaborationEvent
  | { type: 'approval'; id: string; calls: readonly { id?: string; name: string; arguments: string }[] }
  | { type: 'tool'; id?: string; name: string }
  | ({ type: 'tool_result'; id?: string; name: string } & ToolExecutionResult)
  | { type: 'error'; message: string; detail?: string }
  | { type: 'done' };

export function isAgentSseEvent(value: unknown): value is AgentSseEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'done') return true;
  if (event.type === 'task') return typeof event.id === 'string' && /^[A-Za-z0-9_-]{32,128}$/u.test(event.id)
    && ['running', 'completed', 'failed', 'cancelled'].includes(event.status as string);
  if (event.type === 'delta' || event.type === 'reasoning') return typeof event.content === 'string';
  if (event.type === 'plan') {
    return Array.isArray(event.steps)
      && event.steps.every((step) => (
        step !== null
        && typeof step === 'object'
        && !Array.isArray(step)
        && typeof step.title === 'string'
        && ['pending', 'in_progress', 'completed'].includes(step.status)
      ))
      && typeof event.currentStep === 'number'
      && Number.isInteger(event.currentStep)
      && event.currentStep >= 0
      && typeof event.completed === 'boolean';
  }
  if (event.type === 'agent') {
    const budget = event.budget;
    const validBudget = budget === undefined || (
      budget !== null
      && typeof budget === 'object'
      && !Array.isArray(budget)
      && typeof (budget as { maxItems?: unknown }).maxItems === 'number'
      && Number.isInteger((budget as { maxItems: number }).maxItems)
      && (budget as { maxItems: number }).maxItems >= 1
      && typeof (budget as { timeoutMs?: unknown }).timeoutMs === 'number'
      && Number.isInteger((budget as { timeoutMs: number }).timeoutMs)
      && (budget as { timeoutMs: number }).timeoutMs >= 100
      && ((budget as { usedItems?: unknown }).usedItems === undefined || (typeof (budget as { usedItems?: unknown }).usedItems === 'number' && Number.isInteger((budget as { usedItems: number }).usedItems) && (budget as { usedItems: number }).usedItems >= 0))
    );
    return typeof event.role === 'string'
      && ['researcher', 'risk_reviewer'].includes(event.role)
      && typeof event.status === 'string'
      && ['started', 'completed', 'failed'].includes(event.status)
      && validBudget;
  }
  if (event.type === 'approval') {
    return typeof event.id === 'string' && /^[A-Za-z0-9_-]{12,128}$/u.test(event.id)
      && Array.isArray(event.calls)
      && event.calls.every((call) => (
        call !== null
        && typeof call === 'object'
        && !Array.isArray(call)
        && (call.id === undefined || typeof call.id === 'string')
        && typeof call.name === 'string'
        && call.name.length > 0
        && call.name.length <= 64
        && typeof call.arguments === 'string'
        && call.arguments.length <= 8_192
      ));
  }
  if (event.type === 'tool') return typeof event.name === 'string';
  if (event.type === 'error') return typeof event.message === 'string';
  return event.type === 'tool_result'
    && typeof event.name === 'string'
    && typeof event.ok === 'boolean'
    && (event.ok === true ? 'result' in event : typeof event.errorCode === 'string');
}
