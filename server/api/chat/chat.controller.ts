import { Body, Controller, Inject, Ip, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatApplicationService } from '../../application/chat/chat.service.js';
import { toPublicError } from '../../domain/errors/app-error.js';
import { AppLoggerService } from '../../infrastructure/logging/app-logger.service.js';
import { RuntimeTelemetry } from '../../infrastructure/runtime/runtime-telemetry.js';
import type { RequestWithId } from '../request-id.middleware.js';
import { SseEventWriter } from './sse-event-writer.js';

@Controller('api/chat')
export class ChatController {
  constructor(
    @Inject(ChatApplicationService) private readonly chat: ChatApplicationService,
    @Inject(AppLoggerService) private readonly logger: AppLoggerService,
    @Inject(RuntimeTelemetry) private readonly telemetry: RuntimeTelemetry
  ) {}

  @Post('stream')
  async stream(@Req() request: RequestWithId, @Res() response: Response, @Body() body?: unknown, @Ip() ip?: string): Promise<void> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let aborted = false;
    const abort = () => {
      aborted = true;
      controller.abort();
    };
    const writer = new SseEventWriter(response, this.telemetry);

    writer.open();
    request.once('aborted', abort);
    response.once('close', abort);

    try {
      await this.chat.run({
        messages: (body as { messages?: unknown } | undefined)?.messages,
        context: (body as { context?: unknown } | undefined)?.context,
        responseFormat: (body as { responseFormat?: unknown } | undefined)?.responseFormat,
        ip,
        signal: controller.signal,
        onEvent: (event) => writer.write(event)
      });
    } catch (error) {
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
