import { Body, Controller, Inject, Ip, Post, Req, Res, Optional } from '@nestjs/common';
import type { Response } from 'express';
import { ChatApplicationService } from '../../application/chat/chat.service.js';
import { toPublicError } from '../../domain/errors/app-error.js';
import { AppLoggerService } from '../../infrastructure/logging/app-logger.service.js';
import { RuntimeTelemetry } from '../../infrastructure/runtime/runtime-telemetry.js';
import type { RequestWithId } from '../request-id.middleware.js';
import { SseEventWriter } from './sse-event-writer.js';
import { InMemoryTaskRuntime } from '../../application/tasks/task-runtime.js';
import { BackgroundTaskService } from '../../application/tasks/background-task.service.js';

@Controller('api/chat')
export class ChatController {
  constructor(
    @Inject(ChatApplicationService) private readonly chat: ChatApplicationService,
    @Inject(AppLoggerService) private readonly logger: AppLoggerService,
    @Inject(RuntimeTelemetry) private readonly telemetry: RuntimeTelemetry,
    @Inject(InMemoryTaskRuntime) private readonly tasks: InMemoryTaskRuntime = new InMemoryTaskRuntime(),
    @Optional() private readonly background?: BackgroundTaskService
  ) {}

  @Post('stream')
  async stream(@Req() request: RequestWithId, @Res() response: Response, @Body() body?: unknown, @Ip() ip?: string): Promise<void> {
    const startedAt = Date.now();
    const requestBody = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    if (requestBody.background === true && this.background) {
      const idempotencyKey = typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined;
      const handle = this.background.start(({ signal, emit }) => this.chat.run({
        messages: requestBody.messages,
        context: requestBody.context,
        responseFormat: requestBody.responseFormat,
        review: requestBody.review,
        taskType: requestBody.taskType,
        documents: requestBody.documents,
        ip,
        signal,
        onEvent: emit
      }), { idempotencyKey });
      response.status(202).json({ taskId: handle.id, status: 'running' });
      return;
    }
    const controller = new AbortController();
    const task = this.tasks.create();
    let aborted = false;
    const abort = () => {
      aborted = true;
      this.tasks.cancel(task.id);
      controller.abort();
    };
    const writer = new SseEventWriter(response, this.telemetry, { heartbeatMs: 15_000 });

    writer.open();
    writer.write({ type: 'task', id: task.id, status: 'running' });
    request.once('aborted', abort);
    response.once('close', abort);

    try {
      const events = await this.chat.run({
        messages: requestBody.messages,
        context: requestBody.context,
        responseFormat: requestBody.responseFormat,
        review: requestBody.review,
        taskType: requestBody.taskType,
        documents: requestBody.documents,
        ip,
        signal: controller.signal,
        onEvent: (event) => {
          this.tasks.recordEvent(task.id, Date.now(), event);
          writer.write(event);
        }
      });
      if (controller.signal.aborted) this.tasks.complete(task.id, 'cancelled');
      else this.tasks.complete(task.id, events.some((event) => event.type === 'error') ? 'failed' : 'completed');
    } catch (error) {
      this.tasks.complete(task.id, controller.signal.aborted ? 'cancelled' : 'failed');
      if (!aborted) {
        const publicError = toPublicError(error);
        this.logger.error({ event: 'chat_stream_failed', requestId: request.requestId, errorCode: publicError.body.errorCode, durationMs: Date.now() - startedAt });
        writer.write({ type: 'error', message: publicError.body.errorCode });
        writer.done();
      }
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
      writer.finish();
    }
  }
}
