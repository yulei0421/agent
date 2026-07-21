const ORIGIN = 'https://push2.eastmoney.com';

type UnknownRecord = Record<string, unknown>;

function invalidResponse(): Error & { code: string } {
  return Object.assign(new Error('Eastmoney returned an unexpected response.'), { code: 'provider_invalid_response' });
}

function asScaledNumber(value: unknown, scale: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value / scale : null;
}

export function buildEastmoneyUrl(symbol: string): string {
  const stockCode = symbol.replace(/\.(?:SS|SH|SZ)$/, '');
  const exchange = symbol.endsWith('.SZ') ? '0' : '1';
  return `${ORIGIN}/api/qt/stock/get?secid=${exchange}.${encodeURIComponent(stockCode)}&fields=f43,f170,f58,f124`;
}

function observedAt(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || !Number.isInteger(numeric)) throw invalidResponse();
  const milliseconds = String(Math.abs(numeric)).length === 13 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw invalidResponse();
  return date.toISOString();
}

export function parseEastmoneyQuote(payload: unknown) {
  const root: UnknownRecord = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload as UnknownRecord : {};
  const data: UnknownRecord = root.data !== null && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data as UnknownRecord : {};
  const price = asScaledNumber(data.f43, 100);
  const changePercent = asScaledNumber(data.f170, 100);
  if (price === null || changePercent === null) throw invalidResponse();
  return {
    price,
    changePercent,
    currency: 'CNY',
    observedAt: observedAt(data.f124)
  };
}
