import { isIP } from 'node:net';

const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CALENDAR_SOURCE = 'forexfactory';
const MAX_EVENTS = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_VALUE_LENGTH = 80;

type UnknownRecord = Record<string, unknown>;

export interface EconomicCalendarEvent {
  time: string;
  country: string;
  title: string;
  impact: 'low' | 'medium' | 'high' | 'holiday';
  actual?: string;
  forecast?: string;
  previous?: string;
}

export type EconomicCalendarResult =
  | { ok: true; source: typeof CALENDAR_SOURCE; fetchedAt: string; events: EconomicCalendarEvent[] }
  | { ok: false; errorCode: 'request_aborted' | 'calendar_unavailable' | 'calendar_invalid_response' };

export interface CalendarFetchResponse {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}

export type CalendarFetch = (url: string, options?: RequestInit) => Promise<CalendarFetchResponse>;

export interface EconomicCalendarGateway {
  getWeek(options?: { signal?: AbortSignal }): Promise<EconomicCalendarResult>;
}

interface GatewayOptions {
  fetchImpl?: CalendarFetch;
  now?: () => Date;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasIpLiteral(value: string): boolean {
  const ipv4 = value.match(/\d{1,3}(?:\.\d{1,3}){3}/gu) ?? [];
  if (ipv4.some((candidate) => candidate.split('.').every((part) => {
    const numeric = Number(part);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
  }))) return true;
  return (value.match(/[0-9A-Fa-f:.]+/gu) ?? []).some((token) => token.includes(':') && isIP(token) === 6);
}

function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) return undefined;
  if (/(?:^|[^\p{L}\p{N}])[A-Za-z][A-Za-z0-9+.-]*:\/{1,2}\S/iu.test(normalized)) return undefined;
  if (/(?:^|[^\p{L}\p{N}])(?:data|mailto|tel|urn|javascript):\S/iu.test(normalized) || /\bwww\./iu.test(normalized)) return undefined;
  if (hasIpLiteral(normalized)) return undefined;
  return normalized;
}

function country(value: unknown): string | undefined {
  const normalized = safeText(value, 8)?.toUpperCase();
  return normalized && /^[A-Z]{2,3}$/u.test(normalized) ? (normalized === 'USD' ? 'US' : normalized) : undefined;
}

function impact(value: unknown): EconomicCalendarEvent['impact'] | undefined {
  const normalized = safeText(value, 16)?.toLowerCase();
  return normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'holiday' ? normalized : undefined;
}

function timestamp(value: unknown): string | undefined {
  const raw = safeText(value, 64);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function parseEvent(value: unknown): EconomicCalendarEvent | undefined {
  if (!isRecord(value)) return undefined;
  const time = timestamp(value.date);
  const eventCountry = country(value.country);
  const title = safeText(value.title, MAX_TITLE_LENGTH);
  const eventImpact = impact(value.impact);
  const actual = safeText(value.actual, MAX_VALUE_LENGTH);
  const forecast = safeText(value.forecast, MAX_VALUE_LENGTH);
  const previous = safeText(value.previous, MAX_VALUE_LENGTH);
  if (!time || !eventCountry || !title || !eventImpact) return undefined;
  return {
    time,
    country: eventCountry,
    title,
    impact: eventImpact,
    ...(actual ? { actual } : {}),
    ...(forecast ? { forecast } : {}),
    ...(previous ? { previous } : {})
  };
}

export function createEconomicCalendarGateway({ fetchImpl = fetch as CalendarFetch, now = () => new Date(), timeoutMs = 8_000 }: GatewayOptions = {}): EconomicCalendarGateway {
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8_000;
  return {
    async getWeek({ signal }: { signal?: AbortSignal } = {}): Promise<EconomicCalendarResult> {
      if (signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const expiry = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('calendar timeout'));
          }, requestTimeoutMs);
        });
        const operation = fetchImpl(CALENDAR_URL, { signal: controller.signal }).then(async (response) => {
          if (!response?.ok || typeof response.json !== 'function') return { response };
          return { response, payload: await response.json() };
        });
        const { response, payload } = await Promise.race([operation, expiry]);
        if (signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
        if (!response?.ok || typeof response.json !== 'function') return { ok: false, errorCode: 'calendar_unavailable' };
        if (!Array.isArray(payload)) return { ok: false, errorCode: 'calendar_invalid_response' };
        const fetched = now();
        if (!(fetched instanceof Date) || Number.isNaN(fetched.getTime())) return { ok: false, errorCode: 'calendar_invalid_response' };
        return { ok: true, source: CALENDAR_SOURCE, fetchedAt: fetched.toISOString(), events: payload.map(parseEvent).filter((event): event is EconomicCalendarEvent => Boolean(event)).slice(0, MAX_EVENTS) };
      } catch {
        return { ok: false, errorCode: signal?.aborted ? 'request_aborted' : 'calendar_unavailable' };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
    }
  };
}
