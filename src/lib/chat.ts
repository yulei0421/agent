import type { AgentCollaborationEvent, AgentPlanSnapshot } from '../../shared/agent-events.js';
import type { ChatDocument } from './attachments.js';

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };
export type FinancialContext = { financial: { tab: import('../types.js').FinancialTab; symbol: string } };
export type ChatResponseFormat = 'text' | 'financial_research';
export type StreamEvent =
  | { type: 'delta' | 'reasoning'; content: string }
  | { type: 'task'; id: string; status: 'running' | 'completed' | 'failed' | 'cancelled' }
  | ({ type: 'plan' } & AgentPlanSnapshot)
  | AgentCollaborationEvent
  | { type: 'approval'; id: string; calls: readonly { id?: string; name: string; arguments: string }[] }
  | { type: 'tool'; id?: string; name: string }
  | { type: 'tool_result'; id?: string; name: string; ok: boolean; result?: unknown; errorCode?: string }
  | { type: 'error'; message: string }
  | { type: 'done' };
export type StreamHandlers = {
  onDelta?(content: string): void;
  onTask?(event: Extract<StreamEvent, { type: 'task' }>): void;
  onReasoning?(content: string): void;
  onPlan?(event: Extract<StreamEvent, { type: 'plan' }>): void;
  onAgent?(event: Extract<StreamEvent, { type: 'agent' }>): void;
  onApproval?(event: Extract<StreamEvent, { type: 'approval' }>): void;
  onTool?(event: Extract<StreamEvent, { type: 'tool' }>): void;
  onToolResult?(event: Extract<StreamEvent, { type: 'tool_result' }>): void;
  onDone?(): void;
};

function isStreamEvent(value: unknown): value is StreamEvent {
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
    return typeof event.role === 'string'
      && ['researcher', 'risk_reviewer'].includes(event.role)
      && typeof event.status === 'string'
      && ['started', 'completed', 'failed'].includes(event.status);
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
        && typeof call.arguments === 'string'
      ));
  }
  if (event.type === 'tool') return typeof event.name === 'string';
  if (event.type === 'tool_result') return typeof event.name === 'string' && typeof event.ok === 'boolean';
  return event.type === 'error' && typeof event.message === 'string';
}

export async function streamChat(
  messages: readonly ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
  context?: FinancialContext,
  responseFormat: ChatResponseFormat = 'text',
  review = false,
  documents: readonly ChatDocument[] = []
): Promise<void> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, ...(context ? { context } : {}), ...(responseFormat === 'financial_research' ? { responseFormat } : {}), ...(review ? { review: true } : {}), ...(documents.length > 0 ? { documents } : {}) }),
    signal
  });

  if (!response.ok) {
    const error = await response.json().catch((): { error?: unknown } => ({ error: response.statusText })) as { error?: unknown };
    throw new Error(typeof error.error === 'string' ? error.error : `请求失败：${response.status}`);
  }

  if (!response.body) throw new Error('响应不包含流式内容');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.split('\n').find((item) => item.startsWith('data:'));
      if (!line) continue;
      let event: unknown;
      try {
        event = JSON.parse(line.slice(5)) as unknown;
      } catch {
        continue;
      }
      if (!isStreamEvent(event)) continue;
      if (event.type === 'tool') handlers.onTool?.(event);
      if (event.type === 'task') handlers.onTask?.(event);
      if (event.type === 'tool_result') handlers.onToolResult?.(event);
      if (event.type === 'plan') handlers.onPlan?.(event);
      if (event.type === 'agent') handlers.onAgent?.(event);
      if (event.type === 'approval') handlers.onApproval?.(event);
      if (event.type === 'reasoning') handlers.onReasoning?.(event.content);
      if (event.type === 'delta') handlers.onDelta?.(event.content);
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') handlers.onDone?.();
    }
  }
}
