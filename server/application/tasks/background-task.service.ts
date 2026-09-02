import { Injectable } from '@nestjs/common';
import type { AgentSseEvent } from '../../types.js';
import { InMemoryTaskRuntime, type TaskHandle, type TaskSummary } from './task-runtime.js';
import { TaskNotificationService } from './task-notification.service.js';

export interface BackgroundTaskExecutionContext {
  readonly signal: AbortSignal;
  readonly emit: (event: AgentSseEvent) => void;
}

@Injectable()
export class BackgroundTaskService {
  constructor(
    private readonly runtime: InMemoryTaskRuntime,
    private readonly notifications?: TaskNotificationService
  ) {}

  start(
    execute: (context: BackgroundTaskExecutionContext) => Promise<readonly AgentSseEvent[]>,
    options: { idempotencyKey?: string; now?: number } = {}
  ): TaskHandle {
    const handle = this.runtime.create(options.now ?? Date.now(), options.idempotencyKey);
    const run = async (current: TaskHandle): Promise<void> => {
      try {
        let emitted = 0;
        const events = await execute({
          signal: current.signal,
          emit: (event) => { emitted += 1; this.runtime.recordEvent(current.id, Date.now(), event); }
        });
        if (emitted === 0) for (const event of events) this.runtime.recordEvent(current.id, Date.now(), event);
        const summary = this.runtime.complete(current.id, current.signal.aborted ? 'cancelled' : events.some((event) => event.type === 'error') ? 'failed' : 'completed');
        if (summary) await this.notifications?.publish(summary);
      } catch {
        const summary = this.runtime.complete(current.id, current.signal.aborted ? 'cancelled' : 'failed');
        if (summary) await this.notifications?.publish(summary);
      }
    };
    this.runtime.setRerun(handle.id, run);
    void run(handle);
    return handle;
  }

  summary(id: string): TaskSummary | undefined { return this.runtime.summary(id); }
}
