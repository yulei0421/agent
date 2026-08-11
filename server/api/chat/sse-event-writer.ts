import type { Response } from 'express';
import { formatSse } from '../../sse.js';
import type { AgentSseEvent } from '../../types.js';
import type { RuntimeTelemetry } from '../../infrastructure/runtime/runtime-telemetry.js';

export class SseEventWriter {
  private closed = false;
  private opened = false;
  private finished = false;
  private doneWritten = false;

  private readonly onClose = () => {
    this.closed = true;
    this.telemetry.recordSseDisconnect();
  };

  constructor(
    private readonly response: Response,
    private readonly telemetry: Pick<RuntimeTelemetry, 'recordSseDisconnect'>
  ) {}

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.response.status(200);
    this.response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.response.setHeader('Cache-Control', 'no-cache, no-transform');
    this.response.setHeader('Connection', 'keep-alive');
    this.response.flushHeaders();
    this.response.once('close', this.onClose);
  }

  write(event: AgentSseEvent): void {
    if (event.type === 'done') {
      this.done();
      return;
    }
    if (this.doneWritten) return;
    if (!this.canWrite()) return;
    this.response.write(formatSse(event));
  }

  done(): void {
    if (this.doneWritten) return;
    this.doneWritten = true;
    if (!this.canWrite()) return;
    this.response.write(formatSse({ type: 'done' }));
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.response.off('close', this.onClose);
    if (!this.doneWritten && !this.closed && !this.response.writableEnded) this.done();
    if (!this.response.writableEnded) this.response.end();
  }

  private canWrite(): boolean {
    return !this.closed && !this.response.writableEnded;
  }
}
