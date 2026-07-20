const ORIGIN = 'https://push2.eastmoney.com';

function invalidResponse() {
  const error = new Error('Eastmoney returned an unexpected response.');
  error.code = 'provider_invalid_response';
  return error;
}

function asScaledNumber(value, scale) {
  return typeof value === 'number' && Number.isFinite(value) ? value / scale : null;
}

export function buildEastmoneyUrl(symbol) {
  const stockCode = symbol.replace(/\.(?:SS|SH|SZ)$/, '');
  const exchange = symbol.endsWith('.SZ') ? '0' : '1';
  return `${ORIGIN}/api/qt/stock/get?secid=${exchange}.${encodeURIComponent(stockCode)}&fields=f43,f170,f58,f124`;
}

function observedAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || !Number.isInteger(numeric)) throw invalidResponse();
  const milliseconds = String(Math.abs(numeric)).length === 13 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw invalidResponse();
  return date.toISOString();
}

export function parseEastmoneyQuote(payload) {
  const data = payload?.data;
  const price = asScaledNumber(data?.f43, 100);
  const changePercent = asScaledNumber(data?.f170, 100);
  if (price === null || changePercent === null) throw invalidResponse();
  return {
    price,
    changePercent,
    currency: 'CNY',
    observedAt: observedAt(data?.f124)
  };
}
