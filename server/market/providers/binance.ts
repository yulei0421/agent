const ORIGIN = 'https://api.binance.com';

function invalidResponse() {
  const error = new Error('Binance returned an unexpected response.');
  error.code = 'provider_invalid_response';
  return error;
}

function asNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildBinanceTickerUrl(symbol) {
  return `${ORIGIN}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
}

export function buildBinanceKlinesUrl(symbol, { interval, limit }) {
  return `${ORIGIN}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
}

export function parseBinanceQuote(payload, currency) {
  const price = asNumber(payload?.lastPrice);
  if (price === null) throw invalidResponse();
  const closeTime = asNumber(payload.closeTime);
  return {
    price,
    changePercent: asNumber(payload.priceChangePercent),
    currency,
    asOf: closeTime === null ? null : new Date(closeTime).toISOString()
  };
}

export function parseBinanceCandles(payload) {
  if (!Array.isArray(payload) || payload.length === 0) throw invalidResponse();
  return payload.map((candle) => {
    if (!Array.isArray(candle) || candle.length < 6) throw invalidResponse();
    const [time, open, high, low, close, volume] = candle.map(asNumber);
    if (![time, open, high, low, close, volume].every(Number.isFinite)) throw invalidResponse();
    return { time: new Date(time).toISOString(), open, high, low, close, volume };
  });
}
