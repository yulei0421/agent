import { Controller, Get, Query } from '@nestjs/common';
import { MarketSearchService } from '../../application/market/market-search.service.js';
import { AppError } from '../../domain/errors/app-error.js';

@Controller('api/market')
export class MarketController {
  constructor(private readonly marketSearch: MarketSearchService) {}

  @Get('search')
  async search(@Query('q') query: string | undefined): Promise<{ results: Awaited<ReturnType<MarketSearchService['search']>> }> {
    const normalized = typeof query === 'string' ? query.trim() : '';
    if (!normalized || normalized.length > 64) throw new AppError('invalid_request');
    return { results: await this.marketSearch.search(normalized) };
  }
}
