import type { AssetSearchResponse, AssetSearchResult } from '../../market/types.js';
import { AppError } from '../../domain/errors/app-error.js';

export type AssetSearchPort = (query: string, options: { signal?: AbortSignal }) => Promise<AssetSearchResponse>;

export class MarketSearchService {
  constructor(private readonly searchAssets: AssetSearchPort) {}

  async search(query: string, signal?: AbortSignal): Promise<AssetSearchResult[]> {
    const result = await this.searchAssets(query, { signal });
    if (Array.isArray(result)) return result;
    if (result.errorCode === 'request_aborted') throw new AppError('request_aborted');
    return [];
  }
}
