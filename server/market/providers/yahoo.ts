const ORIGIN = 'https://query1.finance.yahoo.com';

function invalidResponse() {
  const error = new Error('Yahoo returned an unexpected response.');
  error.code = 'provider_invalid_response';
  return error;
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function quoteFromChart(result) {
  const meta = result?.meta;
  const price = asNumber(meta?.regularMarketPrice);
  if (price === null) throw invalidResponse();

  const previousClose = asNumber(meta.previousClose);
  return {
    price,
    changePercent: previousClose && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : null,
    currency: typeof meta.currency === 'string' ? meta.currency : null,
    asOf: Array.isArray(result.timestamp) && Number.isFinite(result.timestamp.at(-1))
      ? new Date(result.timestamp.at(-1) * 1000).toISOString()
      : null
  };
}

function candlesFromChart(result) {
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || timestamps.length === 0 || !quote || !Array.isArray(quote.open) || !Array.isArray(quote.high)
    || !Array.isArray(quote.low) || !Array.isArray(quote.close) || !Array.isArray(quote.volume)) {
    throw invalidResponse();
  }

  return timestamps.map((timestamp, index) => {
    const values = [timestamp, quote.open[index], quote.high[index], quote.low[index], quote.close[index], quote.volume[index]];
    if (!values.every(Number.isFinite)) throw invalidResponse();
    return {
      time: new Date(timestamp * 1000).toISOString(),
      open: quote.open[index],
      high: quote.high[index],
      low: quote.low[index],
      close: quote.close[index],
      volume: quote.volume[index]
    };
  });
}

export function buildYahooUrl(symbol, { interval = '1d', range = '1d' } = {}) {
  return `${ORIGIN}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
}

export function parseYahooQuote(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) throw invalidResponse();
  return quoteFromChart(result);
}

export function parseYahooCandles(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) throw invalidResponse();
  return candlesFromChart(result);
}
