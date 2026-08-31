export type ClientTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface ClientTaskSummary {
  id: string;
  status: ClientTaskStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  eventCount: number;
  expiresAt: number;
}

const TASK_ID = /^[A-Za-z0-9_-]{32,128}$/u;

function assertTaskId(id: string): void {
  if (!TASK_ID.test(id)) throw new Error('任务 ID 无效');
}

function parseSummary(value: unknown): ClientTaskSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('任务状态无效');
  const candidate = value as Partial<ClientTaskSummary>;
  const createdAt = candidate.createdAt;
  const updatedAt = candidate.updatedAt;
  const attempts = candidate.attempts;
  const eventCount = candidate.eventCount;
  const expiresAt = candidate.expiresAt;
  if (typeof candidate.id !== 'string' || !TASK_ID.test(candidate.id)
    || typeof candidate.status !== 'string' || !['queued', 'running', 'completed', 'failed', 'cancelled', 'expired'].includes(candidate.status)
    || typeof createdAt !== 'number' || !Number.isFinite(createdAt)
    || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)
    || typeof attempts !== 'number' || !Number.isFinite(attempts)
    || typeof eventCount !== 'number' || !Number.isFinite(eventCount)
    || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    throw new Error('任务状态无效');
  }
  return {
    id: candidate.id,
    status: candidate.status as ClientTaskStatus,
    createdAt,
    updatedAt,
    attempts,
    eventCount,
    expiresAt
  };
}

async function requestTask(path: string, init?: RequestInit): Promise<ClientTaskSummary> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch((): { errorCode?: unknown } => ({})) as { errorCode?: unknown };
    throw new Error(typeof payload.errorCode === 'string' ? payload.errorCode : `任务请求失败：${response.status}`);
  }
  return parseSummary(await response.json());
}

export async function getTask(id: string): Promise<ClientTaskSummary> {
  assertTaskId(id);
  return requestTask(`/api/tasks/${encodeURIComponent(id)}`);
}

export async function cancelTask(id: string): Promise<ClientTaskSummary> {
  assertTaskId(id);
  return requestTask(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}
