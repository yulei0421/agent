import { getAllowedOrigins, getMarketConfig } from './config.js';
import { normalizeSymbol } from './symbols.js';
import { buildBinanceKlinesUrl, buildBinanceTickerUrl, parseBinanceCandles, parseBinanceQuote } from './providers/binance.js';
import { buildEastmoneyUrl, parseEastmoneyQuote } from './providers/eastmoney.js';
import { buildTencentQuoteUrl, parseTencentQuote } from './providers/tencent.js';
import { buildYahooUrl, parseYahooCandles, parseYahooQuote } from './providers/yahoo.js';
import type { MarketConfig } from './config.js';
import type { FetchLike, FetchResponseLike } from './types.js';

const ERROR_MESSAGES = Object.freeze({
  request_aborted: 'Market data request was cancelled.',
  provider_unavailable: 'Market data provider is unavailable.',
  provider_rate_limited: 'Market data provider rate limited the request.',
  provider_invalid_response: 'Market data provider returned an invalid response.',
  provider_not_available: 'This operation is not available for this market.'
});

export type MarketErrorCode = keyof typeof ERROR_MESSAGES;
type MarketOperation = 'quote' | 'candles';
type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
type QuoteData = { price: number; changePercent: number | null; currency?: string | null; observedAt?: string | null; asOf?: string | null };
type Freshness = { asOf: string | null; observedAt: string | null; fetchedAt: string | null; ageSeconds: number | null };
type SuccessResult = {
  ok: true;
  data: QuoteData | Candle[];
  meta: Freshness & { source: MarketConfig['provider']; delay: string; symbol: string; confidence: 'provider'; cached: boolean };
};
type FailureResult = {
  ok: false;
  error: { code: MarketErrorCode; message: string };
  meta: { source: MarketConfig['provider'] | null; symbol: string | null; asOf: null; delay: string | null; confidence: null; cached: false };
};
export type MarketResult = SuccessResult | FailureResult;
type CacheEntry = { result: MarketResult; expiresAt: number };
type InFlightEntry = {
  controller: AbortController;
  consumers: Set<symbol>;
  finished: boolean;
  request: Promise<MarketResult>;
  retire(): void;
};
type GatewayOptions = { fetchImpl?: FetchLike; now?: () => Date; cacheTtlMs?: number; timeoutMs?: number; maxCacheEntries?: number };
type RequestOptions = { signal?: AbortSignal };
type CandleOptions = RequestOptions & { interval?: string; range?: string };

const TENCENT_FALLBACK_CONFIG: MarketConfig = Object.freeze({ configured: true, provider: 'tencent', delay: 'unknown' });

function isMarketErrorCode(value: unknown): value is MarketErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_MESSAGES, value);
}

function errorCode(error: unknown): MarketErrorCode | undefined {
  if (!error || typeof error !== 'object' || !Object.hasOwn(error, 'code')) return undefined;
  const code = (error as { code?: unknown }).code;
  return isMarketErrorCode(code) ? code : undefined;
}

function marketError(code: MarketErrorCode, message = ERROR_MESSAGES[code]): Error & { code: MarketErrorCode } {
  const error = new Error(message);
  return Object.assign(error, { code });
}

function getKlineLimit(range: string | undefined): number {
  const limits: Readonly<Record<string, number>> = { '1d': 24, '5d': 120, '1mo': 720 };
  return limits[range ?? ''] ?? 24;
}

function originIsAllowed(url: string): boolean {
  return getAllowedOrigins().includes(new URL(url).origin);
}

function waitForRequest(entry: InFlightEntry, signal?: AbortSignal): Promise<MarketResult> {
  if (signal?.aborted) return Promise.reject(marketError('request_aborted'));
  return new Promise<MarketResult>((resolve, reject: (error: unknown) => void) => {
    const consumer = Symbol('market-request-consumer');
    let settled = false;
    entry.consumers.add(consumer);
    const release = () => {
      entry.consumers.delete(consumer);
      if (!entry.finished && entry.consumers.size === 0) {
        entry.retire();
        entry.controller.abort();
      }
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      release();
      callback();
    };
    const abort = () => {
      finish(() => reject(marketError('request_aborted')));
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    entry.request.then(
      (value: MarketResult) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

async function awaitResult(entry: InFlightEntry, signal: AbortSignal | undefined, config: MarketConfig, symbol: string): Promise<MarketResult> {
  try {
    return cloneResult(await waitForRequest(entry, signal));
  } catch (error) {
    return failure(error, config, symbol);
  }
}

async function fetchPayload(fetchImpl: FetchLike, url: string, timeoutMs: number, responseType: 'json' | 'text' = 'json', signal?: AbortSignal): Promise<unknown> {
  if (!originIsAllowed(url)) throw marketError('provider_not_available');
  if (signal?.aborted) throw marketError('request_aborted');
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener = () => {};
  const readPayload = async () => {
    let response: FetchResponseLike;
    try {
      response = await fetchImpl(url, { signal: controller.signal });
    } catch {
      throw marketError('provider_unavailable');
    }
    if (!response || typeof response.status !== 'number') throw marketError('provider_invalid_response');
    if (response.status === 429) throw marketError('provider_rate_limited');
    if (!response.ok) throw marketError('provider_unavailable');
    try {
      if (responseType === 'text') {
        if (typeof response.text !== 'function') throw marketError('provider_invalid_response');
        return await response.text();
      }
      if (typeof response.json !== 'function') throw marketError('provider_invalid_response');
      return await response.json();
    } catch {
      throw marketError('provider_invalid_response');
    }
  };
  try {
    const cancelled = new Promise<never>((_, reject: (error: unknown) => void) => {
      const abort = () => {
        controller.abort();
        reject(marketError('request_aborted'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      removeAbortListener = () => signal?.removeEventListener('abort', abort);
    });
    const timeout = new Promise<never>((_, reject: (error: unknown) => void) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(marketError('provider_unavailable'));
      }, timeoutMs);
    });
    return await Promise.race([readPayload(), timeout, cancelled]);
  } catch (error) {
    if (errorCode(error)) throw error;
    throw marketError('provider_unavailable');
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener();
  }
}

function failure(error: unknown, config: MarketConfig | null = null, symbol: string | null = null, fallbackMessage?: string): FailureResult {
  const code = errorCode(error) ?? 'provider_invalid_response';
  return {
    ok: false,
    error: { code, message: fallbackMessage ?? ERROR_MESSAGES[code] },
    meta: {
      source: config?.provider ?? null,
      symbol,
      asOf: null,
      delay: config?.delay ?? null,
      confidence: null,
      cached: false
    }
  };
}

function cloneResult(result: MarketResult, cached = result.meta.cached): MarketResult {
  if (!result.ok) return { ...result, meta: { ...result.meta, cached: false } };
  return {
    ...result,
    ...(Object.hasOwn(result, 'data')
      ? { data: Array.isArray(result.data) ? result.data.map((candle: Candle) => ({ ...candle })) : { ...result.data } }
      : {}),
    meta: { ...result.meta, cached }
  };
}

function clearExpiredCache(cache: Map<string, CacheEntry>, currentTime: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= currentTime) cache.delete(key);
  }
}

function isRecoverableEastmoneyError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'provider_unavailable' || code === 'provider_invalid_response';
}

function serverTimestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw marketError('provider_invalid_response');
  return value.toISOString();
}

function quoteFreshness(parsed: QuoteData, fetchedAt: string): Freshness {
  const observedAt = typeof parsed.observedAt === 'string'
    ? parsed.observedAt
    : typeof parsed.asOf === 'string'
      ? parsed.asOf
      : null;
  if (!observedAt) return { asOf: null, observedAt: null, fetchedAt, ageSeconds: null };

  const observedTime = Date.parse(observedAt);
  const fetchedTime = Date.parse(fetchedAt);
  if (!Number.isFinite(observedTime) || !Number.isFinite(fetchedTime) || observedTime > fetchedTime + 5 * 60 * 1000) {
    throw marketError('provider_invalid_response');
  }
  const normalizedObservedAt = new Date(observedTime).toISOString();
  return {
    asOf: normalizedObservedAt,
    observedAt: normalizedObservedAt,
    fetchedAt,
    ageSeconds: Math.max(0, Math.floor((fetchedTime - observedTime) / 1000))
  };
}

export function createMarketGateway({
  fetchImpl = fetch,
  now = () => new Date(),
  cacheTtlMs = 3000,
  timeoutMs = 8000,
  maxCacheEntries = 200
}: GatewayOptions = {}) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightEntry>();
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000;
  const normalizedCacheTtlMs = Number.isFinite(cacheTtlMs) && cacheTtlMs >= 0 ? cacheTtlMs : 3000;
  const cacheLimit = Number.isInteger(maxCacheEntries) && maxCacheEntries >= 0 ? maxCacheEntries : 200;

  async function execute(
    input: string,
    operation: MarketOperation,
    parameters: { interval?: string; range?: string } = {},
    signal?: AbortSignal
  ): Promise<MarketResult> {
    if (signal?.aborted) return failure(marketError('request_aborted'));
    let symbol: ReturnType<typeof normalizeSymbol>;
    let config: MarketConfig;
    try {
      symbol = normalizeSymbol(input);
      config = getMarketConfig(symbol.market);
    } catch {
      return failure(marketError('provider_not_available'));
    }

    const cacheKey = JSON.stringify([symbol.canonical, operation, parameters]);
    clearExpiredCache(cache, Date.now());
    const cached = cache.get(cacheKey);
    if (cached) {
      return cloneResult(cached.result, true);
    }

    const existing = inFlight.get(cacheKey);
    if (existing) return awaitResult(existing, signal, config, symbol.canonical);

    const controller = new AbortController();
    let entry: InFlightEntry;
    entry = {
      controller,
      consumers: new Set(),
      finished: false,
      request: Promise.resolve(failure(marketError('provider_unavailable'))),
      retire() {
        if (inFlight.get(cacheKey) === entry) inFlight.delete(cacheKey);
      }
    };
    const request: Promise<MarketResult> = (async () => {
      let activeConfig = config;
      try {
      let parsed: QuoteData | Candle[];
      let freshness: Freshness | null = null;
      if (config.provider === 'yahoo-finance') {
        const payload = await fetchPayload(fetchImpl, buildYahooUrl(symbol.providerSymbol, parameters), requestTimeoutMs, 'json', controller.signal);
        parsed = operation === 'quote' ? parseYahooQuote(payload) : parseYahooCandles(payload);
        freshness = operation === 'quote' ? quoteFreshness(parsed as QuoteData, serverTimestamp(now)) : null;
      } else if (config.provider === 'eastmoney') {
        if (operation !== 'quote') {
          return failure(marketError('provider_not_available'), config, symbol.canonical, 'Candles are not available for this market.');
        }
        try {
          parsed = parseEastmoneyQuote(await fetchPayload(fetchImpl, buildEastmoneyUrl(symbol.providerSymbol), requestTimeoutMs, 'json', controller.signal));
          freshness = quoteFreshness(parsed as QuoteData, serverTimestamp(now));
        } catch (error) {
          if (!isRecoverableEastmoneyError(error)) throw error;
          activeConfig = TENCENT_FALLBACK_CONFIG;
          parsed = parseTencentQuote(await fetchPayload(fetchImpl, buildTencentQuoteUrl(symbol), requestTimeoutMs, 'text', controller.signal));
          freshness = quoteFreshness(parsed as QuoteData, serverTimestamp(now));
        }
      } else if (config.provider === 'tencent') {
        if (operation !== 'quote') {
          return failure(marketError('provider_not_available'), config, symbol.canonical, 'Candles are not available for this market.');
        }
        parsed = parseTencentQuote(await fetchPayload(fetchImpl, buildTencentQuoteUrl(symbol), requestTimeoutMs, 'text', controller.signal));
        freshness = quoteFreshness(parsed as QuoteData, serverTimestamp(now));
      } else if (config.provider === 'binance') {
        if (operation === 'quote') {
          const currency = symbol.canonical.split('/')[1] ?? '';
          parsed = parseBinanceQuote(await fetchPayload(fetchImpl, buildBinanceTickerUrl(symbol.providerSymbol), requestTimeoutMs, 'json', controller.signal), currency);
          freshness = quoteFreshness(parsed as QuoteData, serverTimestamp(now));
        } else {
          const limit = getKlineLimit(parameters.range);
          parsed = parseBinanceCandles(await fetchPayload(fetchImpl, buildBinanceKlinesUrl(symbol.providerSymbol, { interval: parameters.interval ?? '1h', limit }), requestTimeoutMs, 'json', controller.signal));
        }
      } else {
        throw marketError('provider_not_available');
      }

      const result: SuccessResult = {
        ok: true,
        data: operation === 'quote'
          ? { price: (parsed as QuoteData).price, changePercent: (parsed as QuoteData).changePercent, currency: (parsed as QuoteData).currency }
          : parsed as Candle[],
        meta: {
          source: activeConfig.provider,
          ...(operation === 'quote' && freshness ? freshness : { asOf: null, observedAt: null, fetchedAt: null, ageSeconds: null }),
          delay: activeConfig.delay,
          symbol: symbol.canonical,
          confidence: 'provider',
          cached: false
        }
      };
      if (cacheLimit > 0) {
        while (cache.size >= cacheLimit) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey) cache.delete(oldestKey);
        }
        cache.set(cacheKey, {
          result: cloneResult(result),
          expiresAt: Date.now() + normalizedCacheTtlMs
        });
      }
        return result;
      } catch (error) {
        return failure(error, activeConfig, symbol.canonical);
      }
    })();
    entry.request = request.finally(() => {
      entry.finished = true;
      entry.retire();
    });
    inFlight.set(cacheKey, entry);
    return awaitResult(entry, signal, config, symbol.canonical);
  }

  return {
    getQuote(input: string, { signal }: RequestOptions = {}) {
      return execute(input, 'quote', {}, signal);
    },
    getCandles(input: string, { interval = '1h', range = '1d', signal }: CandleOptions = {}) {
      return execute(input, 'candles', { interval, range }, signal);
    }
  };
}
