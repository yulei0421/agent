import { getAllowedOrigins, getMarketConfig } from './config.js';
import { normalizeSymbol } from './symbols.js';
import { buildBinanceKlinesUrl, buildBinanceTickerUrl, parseBinanceCandles, parseBinanceQuote } from './providers/binance.js';
import { buildEastmoneyUrl, parseEastmoneyQuote } from './providers/eastmoney.js';
import { buildTencentQuoteUrl, parseTencentQuote } from './providers/tencent.js';
import { buildYahooUrl, parseYahooCandles, parseYahooQuote } from './providers/yahoo.js';

const ERROR_MESSAGES = Object.freeze({
  provider_unavailable: 'Market data provider is unavailable.',
  provider_rate_limited: 'Market data provider rate limited the request.',
  provider_invalid_response: 'Market data provider returned an invalid response.',
  provider_not_available: 'This operation is not available for this market.'
});

const TENCENT_FALLBACK_CONFIG = Object.freeze({ provider: 'tencent', delay: 'unknown' });

function marketError(code, message = ERROR_MESSAGES[code]) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getKlineLimit(range) {
  return ({ '1d': 24, '5d': 120, '1mo': 720 })[range] ?? 24;
}

function originIsAllowed(url) {
  return getAllowedOrigins().includes(new URL(url).origin);
}

async function fetchPayload(fetchImpl, url, timeoutMs, responseType = 'json') {
  if (!originIsAllowed(url)) throw marketError('provider_not_available');
  const controller = new AbortController();
  let timeoutId;
  const readPayload = async () => {
    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal });
    } catch {
      throw marketError('provider_unavailable');
    }
    if (!response || typeof response.status !== 'number') throw marketError('provider_invalid_response');
    if (response.status === 429) throw marketError('provider_rate_limited');
    if (!response.ok) throw marketError('provider_unavailable');
    try {
      return responseType === 'text' ? await response.text() : await response.json();
    } catch {
      throw marketError('provider_invalid_response');
    }
  };
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(marketError('provider_unavailable'));
      }, timeoutMs);
    });
    return await Promise.race([readPayload(), timeout]);
  } catch (error) {
    if (Object.hasOwn(ERROR_MESSAGES, error?.code)) throw error;
    throw marketError('provider_unavailable');
  } finally {
    clearTimeout(timeoutId);
  }
}

function failure(error, config = null, symbol = null, fallbackMessage) {
  const code = Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : 'provider_invalid_response';
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

function cloneResult(result, cached = result.meta.cached) {
  return {
    ...result,
    data: Array.isArray(result.data) ? result.data.map((candle) => ({ ...candle })) : { ...result.data },
    meta: { ...result.meta, cached }
  };
}

function clearExpiredCache(cache, currentTime) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= currentTime) cache.delete(key);
  }
}

function isRecoverableEastmoneyError(error) {
  return error?.code === 'provider_unavailable' || error?.code === 'provider_invalid_response';
}

function serverTimestamp(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw marketError('provider_invalid_response');
  return value.toISOString();
}

function quoteFreshness(parsed, fetchedAt) {
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
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000;
  const normalizedCacheTtlMs = Number.isFinite(cacheTtlMs) && cacheTtlMs >= 0 ? cacheTtlMs : 3000;
  const cacheLimit = Number.isInteger(maxCacheEntries) && maxCacheEntries >= 0 ? maxCacheEntries : 200;

  async function execute(input, operation, parameters = {}) {
    let symbol;
    let config;
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

    const pending = inFlight.get(cacheKey);
    if (pending) return cloneResult(await pending);

    const request = (async () => {
      let activeConfig = config;
      try {
      let parsed;
      let freshness;
      if (config.provider === 'yahoo-finance') {
        const payload = await fetchPayload(fetchImpl, buildYahooUrl(symbol.providerSymbol, parameters), requestTimeoutMs);
        parsed = operation === 'quote' ? parseYahooQuote(payload) : parseYahooCandles(payload);
        freshness = operation === 'quote' ? quoteFreshness(parsed, serverTimestamp(now)) : null;
      } else if (config.provider === 'eastmoney') {
        if (operation !== 'quote') {
          return failure(marketError('provider_not_available'), config, symbol.canonical, 'Candles are not available for this market.');
        }
        try {
          parsed = parseEastmoneyQuote(await fetchPayload(fetchImpl, buildEastmoneyUrl(symbol.providerSymbol), requestTimeoutMs));
          freshness = quoteFreshness(parsed, serverTimestamp(now));
        } catch (error) {
          if (!isRecoverableEastmoneyError(error)) throw error;
          activeConfig = TENCENT_FALLBACK_CONFIG;
          parsed = parseTencentQuote(await fetchPayload(fetchImpl, buildTencentQuoteUrl(symbol), requestTimeoutMs, 'text'));
          freshness = quoteFreshness(parsed, serverTimestamp(now));
        }
      } else if (config.provider === 'tencent') {
        if (operation !== 'quote') {
          return failure(marketError('provider_not_available'), config, symbol.canonical, 'Candles are not available for this market.');
        }
        parsed = parseTencentQuote(await fetchPayload(fetchImpl, buildTencentQuoteUrl(symbol), requestTimeoutMs, 'text'));
        freshness = quoteFreshness(parsed, serverTimestamp(now));
      } else if (config.provider === 'binance') {
        if (operation === 'quote') {
          const currency = symbol.canonical.split('/')[1];
          parsed = parseBinanceQuote(await fetchPayload(fetchImpl, buildBinanceTickerUrl(symbol.providerSymbol), requestTimeoutMs), currency);
          freshness = quoteFreshness(parsed, serverTimestamp(now));
        } else {
          const limit = getKlineLimit(parameters.range);
          parsed = parseBinanceCandles(await fetchPayload(fetchImpl, buildBinanceKlinesUrl(symbol.providerSymbol, { interval: parameters.interval, limit }), requestTimeoutMs));
        }
      } else {
        throw marketError('provider_not_available');
      }

      const result = {
        ok: true,
        data: operation === 'quote'
          ? { price: parsed.price, changePercent: parsed.changePercent, currency: parsed.currency }
          : parsed,
        meta: {
          source: activeConfig.provider,
          ...(operation === 'quote' ? freshness : { asOf: null, observedAt: null, fetchedAt: null, ageSeconds: null }),
          delay: activeConfig.delay,
          symbol: symbol.canonical,
          confidence: 'provider',
          cached: false
        }
      };
      if (cacheLimit > 0) {
        while (cache.size >= cacheLimit) {
          cache.delete(cache.keys().next().value);
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
    inFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
    }
  }

  return {
    getQuote(input) {
      return execute(input, 'quote');
    },
    getCandles(input, { interval = '1h', range = '1d' } = {}) {
      return execute(input, 'candles', { interval, range });
    }
  };
}
