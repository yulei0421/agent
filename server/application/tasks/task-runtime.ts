import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

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

interface TaskEntry extends TaskSummary {
  readonly controller: AbortController;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;

@Injectable()
export class InMemoryTaskRuntime {
  private readonly entries = new Map<string, TaskEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.maxEntries = options.maxEntries ?? 100;
    if (!Number.isInteger(this.ttlMs) || this.ttlMs < 1_000 || this.ttlMs > 24 * 60 * 60_000) throw new Error('Task TTL is out of range');
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1 || this.maxEntries > 10_000) throw new Error('Task maxEntries is out of range');
  }

  create(now = Date.now()): TaskHandle {
    this.prune(now);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== 'string') break;
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
      controller
    });
    return { id, signal: controller.signal };
  }

  recordEvent(id: string, now = Date.now()): boolean {
    const entry = this.active(id, now);
    if (!entry || entry.status !== 'running') return false;
    entry.eventCount += 1;
    entry.updatedAt = now;
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
        this.entries.delete(id);
      }
    }
  }

  private toSummary(entry: TaskEntry): TaskSummary {
    const { controller: _controller, ...summary } = entry;
    return { ...summary };
  }
}
