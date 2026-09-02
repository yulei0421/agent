import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AgentSseEvent } from '../../types.js';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface TaskSummary {
  id: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  eventCount: number;
  expiresAt: number;
}

export interface TaskHandle {
  readonly id: string;
  readonly signal: AbortSignal;
}

export interface TaskEventEnvelope {
  readonly sequence: number;
  readonly at: number;
  readonly event: AgentSseEvent;
}

interface TaskEntry extends TaskSummary {
  controller: AbortController;
  readonly events: TaskEventEnvelope[];
  readonly idempotencyKey?: string;
  rerun?: (handle: TaskHandle) => Promise<void>;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;

@Injectable()
export class InMemoryTaskRuntime {
  private readonly entries = new Map<string, TaskEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly idempotency = new Map<string, string>();

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.maxEntries = options.maxEntries ?? 100;
    if (!Number.isInteger(this.ttlMs) || this.ttlMs < 1_000 || this.ttlMs > 24 * 60 * 60_000) throw new Error('Task TTL is out of range');
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1 || this.maxEntries > 10_000) throw new Error('Task maxEntries is out of range');
  }

  create(now = Date.now(), idempotencyKey?: string): TaskHandle {
    this.prune(now);
    if (idempotencyKey) {
      const existingId = this.idempotency.get(idempotencyKey);
      const existing = existingId ? this.entries.get(existingId) : undefined;
      if (existing) return { id: existing.id, signal: existing.controller.signal };
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== 'string') break;
      const entry = this.entries.get(oldest);
      if (entry?.idempotencyKey) this.idempotency.delete(entry.idempotencyKey);
      this.entries.delete(oldest);
    }
    const id = randomBytes(32).toString('base64url');
    const controller = new AbortController();
    this.entries.set(id, {
      id,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      attempts: 1,
      eventCount: 0,
      expiresAt: now + this.ttlMs,
      controller,
      events: [],
      ...(idempotencyKey ? { idempotencyKey } : {})
    });
    if (idempotencyKey) this.idempotency.set(idempotencyKey, id);
    return { id, signal: controller.signal };
  }

  recordEvent(id: string, now = Date.now(), event?: AgentSseEvent): boolean {
    const entry = this.active(id, now);
    if (!entry || entry.status !== 'running') return false;
    entry.eventCount += 1;
    entry.updatedAt = now;
    if (event) entry.events.push({ sequence: entry.events.length + 1, at: now, event });
    return true;
  }

  events(id: string, afterSequence = 0, now = Date.now()): readonly TaskEventEnvelope[] {
    const entry = this.active(id, now);
    return entry ? entry.events.filter((item) => item.sequence > afterSequence).map((item) => ({ ...item })) : [];
  }

  retry(id: string, now = Date.now()): TaskHandle | undefined {
    const entry = this.active(id, now);
    if (!entry || (entry.status !== 'failed' && entry.status !== 'cancelled')) return undefined;
    entry.controller = new AbortController();
    entry.status = 'running';
    entry.attempts += 1;
    entry.updatedAt = now;
    entry.events.push({ sequence: entry.events.length + 1, at: now, event: { type: 'task', id, status: 'running' } });
    const handle = { id, signal: entry.controller.signal };
    if (entry.rerun) void entry.rerun(handle);
    return handle;
  }

  setRerun(id: string, rerun: (handle: TaskHandle) => Promise<void>): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.rerun = rerun;
    return true;
  }

  cancel(id: string, now = Date.now()): TaskSummary | undefined {
    const entry = this.active(id, now);
    if (!entry) return undefined;
    if (entry.status === 'running' || entry.status === 'queued') {
      entry.controller.abort();
      entry.status = 'cancelled';
      entry.updatedAt = now;
    }
    return this.toSummary(entry);
  }

  complete(id: string, status: Extract<TaskStatus, 'completed' | 'failed' | 'cancelled'>, now = Date.now()): TaskSummary | undefined {
    const entry = this.active(id, now);
    if (!entry) return undefined;
    if (entry.status === 'running' || entry.status === 'queued') {
      if (status === 'cancelled') entry.controller.abort();
      entry.status = status;
      entry.updatedAt = now;
    }
    return this.toSummary(entry);
  }

  summary(id: string, now = Date.now()): TaskSummary | undefined {
    if (!TOKEN_PATTERN.test(id)) return undefined;
    const entry = this.active(id, now);
    return entry ? this.toSummary(entry) : undefined;
  }

  private active(id: string, now: number): TaskEntry | undefined {
    if (!TOKEN_PATTERN.test(id)) return undefined;
    this.prune(now);
    return this.entries.get(id);
  }

  private prune(now: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        if (entry.status === 'running' || entry.status === 'queued') entry.controller.abort();
        if (entry.idempotencyKey) this.idempotency.delete(entry.idempotencyKey);
        this.entries.delete(id);
      }
    }
  }

  private toSummary(entry: TaskEntry): TaskSummary {
    const { controller: _controller, events: _events, idempotencyKey: _idempotencyKey, rerun: _rerun, ...summary } = entry;
    return { ...summary };
  }
}
