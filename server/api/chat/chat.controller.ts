import { Body, Controller, Inject, Ip, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatApplicationService } from '../../application/chat/chat.service.js';
import { toPublicError } from '../../domain/errors/app-error.js';
import { formatSse } from '../../sse.js';
import { AppLoggerService } from '../../infrastructure/logging/app-logger.service.js';
import type { RequestWithId } from '../request-id.middleware.js';

@Controller('api/chat')
export class ChatController {
  constructor(
    @Inject(ChatApplicationService) private readonly chat: ChatApplicationService,
    @Inject(AppLoggerService) private readonly logger: AppLoggerService
  ) {}

  @Post('stream')
  async stream(@Req() request: RequestWithId, @Res() response: Response, @Body() body?: unknown, @Ip() ip?: string): Promise<void> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let closed = false;
    const abort = () => {
      closed = true;
      controller.abort();
    };

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    request.once('aborted', abort);
    response.once('close', abort);

    try {
      await this.chat.run({
        messages: (body as { messages?: unknown } | undefined)?.messages,
        context: (body as { context?: unknown } | undefined)?.context,
        ip,
        signal: controller.signal,
        onEvent: (event) => {
          if (!closed && !response.writableEnded) response.write(formatSse(event));
        }
      });
    } catch (error) {
      if (!closed && !response.writableEnded) {
        const publicError = toPublicError(error);
        this.logger.error({ event: 'chat_stream_failed', requestId: request.requestId, errorCode: publicError.body.errorCode, durationMs: Date.now() - startedAt });
        response.write(formatSse({ type: 'error', message: publicError.body.errorCode }));
        response.write(formatSse({ type: 'done' }));
      }
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
      if (!response.writableEnded) response.end();
    }
  }
}
