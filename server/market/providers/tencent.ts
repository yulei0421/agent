import type { NormalizedSymbol } from '../symbols.ts';

const ORIGIN = 'https://qt.gtimg.cn';

function invalidResponse(): Error & { code: string } {
  return Object.assign(new Error('Tencent returned an unexpected response.'), { code: 'provider_invalid_response' });
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseTimestamp(dateValue: unknown, timeValue: unknown): string | null {
  const dateDigits = String(dateValue ?? '').replace(/[^0-9]/g, '');
  const timeDigits = String(timeValue ?? '').replace(/[^0-9]/g, '');
  const compact = /^\d{14}$/.test(dateDigits)
    ? dateDigits
    : /^\d{8}$/.test(dateDigits) && /^\d{6}$/.test(timeDigits)
      ? `${dateDigits}${timeDigits}`
      : '';
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/);
  if (!match) return null;

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

export function buildTencentQuoteUrl(symbol: NormalizedSymbol): string {
  const canonical = symbol.canonical;
  if (symbol.market === 'cn' && /^\d{6}\.SH$/.test(canonical)) {
    return `${ORIGIN}/q=sh${canonical.slice(0, 6)}`;
  }
  if (symbol.market === 'cn' && /^\d{6}\.SZ$/.test(canonical)) {
    return `${ORIGIN}/q=sz${canonical.slice(0, 6)}`;
  }
  if (symbol.market === 'hk' && /^\d{4,5}\.HK$/.test(canonical)) {
    return `${ORIGIN}/q=hk${canonical.slice(0, -3).padStart(5, '0')}`;
  }
  throw invalidResponse();
}

export function parseTencentQuote(payload: unknown) {
  if (typeof payload !== 'string') throw invalidResponse();
  const match = payload.match(/v_(sz|sh|hk)\d+="([^"]*)"/i);
  if (!match) throw invalidResponse();

  const exchange = match[1];
  const quote = match[2];
  if (!exchange || !quote) throw invalidResponse();
  const fields = quote.split('~');
  const name = fields[1]?.trim();
  const price = asNumber(fields[3]);
  const previousClose = asNumber(fields[4]);
  if (!name || price === null || previousClose === null || previousClose === 0) throw invalidResponse();

  const changePercent = ((price - previousClose) / previousClose) * 100;
  if (!Number.isFinite(changePercent)) throw invalidResponse();

  return {
    name,
    price,
    previousClose,
    changePercent,
    currency: exchange.toLowerCase() === 'hk' ? 'HKD' : 'CNY',
    asOf: parseTimestamp(fields[30], fields[31])
  };
}
