import type { AssetSearchResponse } from '../market/types.js';

type AssetSearch = (query: string, options: { signal?: AbortSignal }) => Promise<AssetSearchResponse>;
type MarketSearchRequest = { query: { q?: unknown }; once(event: 'aborted', listener: () => void): unknown; off(event: 'aborted', listener: () => void): unknown };
type MarketSearchResponse = {
  status(code: number): MarketSearchResponse;
  json(body: unknown): unknown;
  once(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
};

export function createMarketSearchHandler(assetSearch: AssetSearch) {
  return async function marketSearchHandler(req: MarketSearchRequest, res: MarketSearchResponse) {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query || query.length > 64) {
      return res.status(400).json({ error: 'q must contain 1 to 64 characters' });
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once('aborted', abort);
    res.once('close', abort);
    try {
      const result = await assetSearch(query, { signal: controller.signal });
      if (!Array.isArray(result) && result.errorCode === 'request_aborted') {
        return res.status(499).json({ errorCode: 'request_aborted' });
      }
      return res.json({ results: Array.isArray(result) ? result : [] });
    } finally {
      req.off('aborted', abort);
      res.off('close', abort);
    }
  };
}
