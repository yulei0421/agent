import { Body, Controller, Inject, Ip, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ChatApplicationService } from '../../application/chat/chat.service.js';
import { toPublicError } from '../../domain/errors/app-error.js';
import { formatSse } from '../../sse.js';

@Controller('api/chat')
export class ChatController {
  constructor(@Inject(ChatApplicationService) private readonly chat: ChatApplicationService) {}

  @Post('stream')
  async stream(@Req() request: Request, @Res() response: Response, @Body() body?: unknown, @Ip() ip?: string): Promise<void> {
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
      const events = await this.chat.run({
        messages: (body as { messages?: unknown } | undefined)?.messages,
        context: (body as { context?: unknown } | undefined)?.context,
        ip,
        signal: controller.signal
      });
      if (!closed && !response.writableEnded) {
        for (const event of events) response.write(formatSse(event));
      }
    } catch (error) {
      // Keep the public SSE error stable while retaining the server-side cause.
      console.error('Chat stream failed:', error);
      if (!closed && !response.writableEnded) {
        const publicError = toPublicError(error);
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
