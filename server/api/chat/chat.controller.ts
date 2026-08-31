import { Body, Controller, Inject, Ip, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatApplicationService } from '../../application/chat/chat.service.js';
import { toPublicError } from '../../domain/errors/app-error.js';
import { AppLoggerService } from '../../infrastructure/logging/app-logger.service.js';
import { RuntimeTelemetry } from '../../infrastructure/runtime/runtime-telemetry.js';
import type { RequestWithId } from '../request-id.middleware.js';
import { SseEventWriter } from './sse-event-writer.js';
import { InMemoryTaskRuntime } from '../../application/tasks/task-runtime.js';

@Controller('api/chat')
export class ChatController {
  constructor(
    @Inject(ChatApplicationService) private readonly chat: ChatApplicationService,
    @Inject(AppLoggerService) private readonly logger: AppLoggerService,
    @Inject(RuntimeTelemetry) private readonly telemetry: RuntimeTelemetry,
    @Inject(InMemoryTaskRuntime) private readonly tasks: InMemoryTaskRuntime = new InMemoryTaskRuntime()
  ) {}

  @Post('stream')
  async stream(@Req() request: RequestWithId, @Res() response: Response, @Body() body?: unknown, @Ip() ip?: string): Promise<void> {
    const startedAt = Date.now();
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
        messages: (body as { messages?: unknown } | undefined)?.messages,
        context: (body as { context?: unknown } | undefined)?.context,
        responseFormat: (body as { responseFormat?: unknown } | undefined)?.responseFormat,
        review: (body as { review?: unknown } | undefined)?.review,
        taskType: (body as { taskType?: unknown } | undefined)?.taskType,
        documents: (body as { documents?: unknown } | undefined)?.documents,
        ip,
        signal: controller.signal,
        onEvent: (event) => {
          this.tasks.recordEvent(task.id);
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
