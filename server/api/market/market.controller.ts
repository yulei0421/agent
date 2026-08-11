import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MarketSearchService } from '../../application/market/market-search.service.js';
import { toPublicError } from '../../domain/errors/app-error.js';
import { AppLoggerService } from '../../infrastructure/logging/app-logger.service.js';
import type { RequestWithId } from '../request-id.middleware.js';

@Controller('api/market')
export class MarketController {
  constructor(
    @Inject(MarketSearchService) private readonly marketSearch: MarketSearchService,
    @Inject(AppLoggerService) private readonly logger: AppLoggerService
  ) {}

  @Get('search')
  async search(@Query('q') query: string | undefined, @Req() request: RequestWithId, @Res() response: Response): Promise<void> {
    const startedAt = Date.now();
    const normalized = typeof query === 'string' ? query.trim() : '';
    if (!normalized || normalized.length > 64) {
      response.status(400).json({ errorCode: 'invalid_request' });
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once('aborted', abort);
    response.once('close', abort);
    try {
      const results = await this.marketSearch.search(normalized, controller.signal);
      if (!controller.signal.aborted && !response.writableEnded) {
        this.logger.info({ event: 'market_search_completed', requestId: request.requestId, durationMs: Date.now() - startedAt });
        response.status(200).json({ results });
      }
    } catch (error) {
      if (!controller.signal.aborted && !response.writableEnded) {
        const publicError = toPublicError(error);
        this.logger.error({ event: 'market_search_failed', requestId: request.requestId, errorCode: publicError.body.errorCode, durationMs: Date.now() - startedAt });
        response.status(publicError.status).json(publicError.body);
      }
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
    }
  }
}
