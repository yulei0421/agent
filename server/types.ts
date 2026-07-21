export type ToolExecutionResult =
  | { ok: true; name: string; result: Record<string, unknown> | unknown[] }
  | { ok: false; name: string; errorCode: string };

export type AgentSseEvent =
  | { type: 'delta' | 'reasoning'; content: string }
  | { type: 'tool'; id?: string; name: string }
  | ({ type: 'tool_result'; id?: string; name: string } & ToolExecutionResult)
  | { type: 'error'; message: string; detail?: string }
  | { type: 'done' };

export function isAgentSseEvent(value: unknown): value is AgentSseEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'done') return true;
  if (event.type === 'delta' || event.type === 'reasoning') return typeof event.content === 'string';
  if (event.type === 'tool') return typeof event.name === 'string';
  if (event.type === 'error') return typeof event.message === 'string';
  return event.type === 'tool_result'
    && typeof event.name === 'string'
    && typeof event.ok === 'boolean'
    && (event.ok === true ? 'result' in event : typeof event.errorCode === 'string');
}
