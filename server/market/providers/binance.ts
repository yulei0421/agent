const ORIGIN = 'https://api.binance.com';

type UnknownRecord = Record<string, unknown>;

function invalidResponse(): Error & { code: string } {
  return Object.assign(new Error('Binance returned an unexpected response.'), { code: 'provider_invalid_response' });
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildBinanceTickerUrl(symbol: string): string {
  return `${ORIGIN}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
}

export function buildBinanceKlinesUrl(symbol: string, { interval, limit }: { interval: string; limit: number }): string {
  return `${ORIGIN}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
}

export function parseBinanceQuote(payload: unknown, currency: string | undefined) {
  const record: UnknownRecord = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload as UnknownRecord : {};
  const price = asNumber(record.lastPrice);
  if (price === null) throw invalidResponse();
  const closeTime = asNumber(record.closeTime);
  return {
    price,
    changePercent: asNumber(record.priceChangePercent),
    currency,
    asOf: closeTime === null ? null : new Date(closeTime).toISOString()
  };
}

export function parseBinanceCandles(payload: unknown) {
  if (!Array.isArray(payload) || payload.length === 0) throw invalidResponse();
  return payload.map((candle: unknown) => {
    if (!Array.isArray(candle) || candle.length < 6) throw invalidResponse();
    const [time = Number.NaN, open = Number.NaN, high = Number.NaN, low = Number.NaN, close = Number.NaN, volume = Number.NaN] = candle.map((value) => asNumber(value) ?? Number.NaN);
    if (![time, open, high, low, close, volume].every(Number.isFinite)) throw invalidResponse();
    return { time: new Date(time).toISOString(), open, high, low, close, volume };
  });
}
