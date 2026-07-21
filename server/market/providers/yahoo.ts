const ORIGIN = 'https://query1.finance.yahoo.com';
type UnknownRecord = Record<string, unknown>;

function invalidResponse(): Error & { code: string } {
  return Object.assign(new Error('Yahoo returned an unexpected response.'), { code: 'provider_invalid_response' });
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function quoteFromChart(result: UnknownRecord) {
  const meta: UnknownRecord = result.meta !== null && typeof result.meta === 'object' && !Array.isArray(result.meta) ? result.meta as UnknownRecord : {};
  const price = asNumber(meta.regularMarketPrice);
  if (price === null) throw invalidResponse();

  const previousClose = asNumber(meta.previousClose);
  return {
    price,
    changePercent: previousClose && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : null,
    currency: typeof meta.currency === 'string' ? meta.currency : null,
    asOf: Array.isArray(result.timestamp) && Number.isFinite(result.timestamp.at(-1))
      ? new Date((result.timestamp.at(-1) as number) * 1000).toISOString()
      : null
  };
}

function candlesFromChart(result: UnknownRecord) {
  const timestamps = result.timestamp;
  const indicators = result.indicators !== null && typeof result.indicators === 'object' && !Array.isArray(result.indicators)
    ? result.indicators as UnknownRecord
    : {};
  const quote = Array.isArray(indicators.quote) && indicators.quote[0] !== null && typeof indicators.quote[0] === 'object' && !Array.isArray(indicators.quote[0])
    ? indicators.quote[0] as UnknownRecord
    : null;
  if (!Array.isArray(timestamps) || timestamps.length === 0 || !quote || !Array.isArray(quote.open) || !Array.isArray(quote.high)
    || !Array.isArray(quote.low) || !Array.isArray(quote.close) || !Array.isArray(quote.volume)) {
    throw invalidResponse();
  }
  const opens = quote.open;
  const highs = quote.high;
  const lows = quote.low;
  const closes = quote.close;
  const volumes = quote.volume;

  return timestamps.map((timestamp, index) => {
    const values = [timestamp, opens[index], highs[index], lows[index], closes[index], volumes[index]].map((value) => asNumber(value) ?? Number.NaN);
    if (!values.every(Number.isFinite)) throw invalidResponse();
    const [time = Number.NaN, open = Number.NaN, high = Number.NaN, low = Number.NaN, close = Number.NaN, volume = Number.NaN] = values;
    return {
      time: new Date(time * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume
    };
  });
}

export function buildYahooUrl(symbol: string, { interval = '1d', range = '1d' }: { interval?: string; range?: string } = {}): string {
  return `${ORIGIN}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
}

function chartResult(payload: unknown): UnknownRecord | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const chart = (payload as UnknownRecord).chart;
  if (!chart || typeof chart !== 'object' || Array.isArray(chart)) return null;
  const result = (chart as UnknownRecord).result;
  const first = Array.isArray(result) ? result[0] : null;
  return first && typeof first === 'object' && !Array.isArray(first) ? first as UnknownRecord : null;
}

export function parseYahooQuote(payload: unknown) {
  const result = chartResult(payload);
  if (!result) throw invalidResponse();
  return quoteFromChart(result);
}

export function parseYahooCandles(payload: unknown) {
  const result = chartResult(payload);
  if (!result) throw invalidResponse();
  return candlesFromChart(result);
}
