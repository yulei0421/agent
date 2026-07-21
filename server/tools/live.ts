import { isIP } from 'node:net';
import type { FetchLike, FetchResponseLike } from '../market/types.js';

const GEO_ORIGIN = 'https://ipwho.is';
const GEOCODING_ORIGIN = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_ORIGIN = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const TIMEOUT_MS = 8000;
const BUILT_IN_CITY_LOCATIONS = new Map([
  ['上海', { city: '上海', latitude: 31.22222, longitude: 121.45806, timeZone: 'Asia/Shanghai' }]
]);
const LIVE_INTENT = /(天气|气温|降雨|台风|今天|今日|当前|现在|实时|最新)/u;
const WEATHER_INTENT = /(天气|气温|降雨|台风|风力|湿度)/u;
const NEWS_INTENT = /(新闻|消息|报道|资讯|公告|研报)/u;

class LiveToolError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type UnknownRecord = Record<string, unknown>;
type Location = { city: string; latitude: number; longitude: number };
type GeocodingLocation = Location & { name: string; timezone: string };
type WeatherCurrent = {
  time: string;
  temperature_2m: number;
  apparent_temperature: number;
  weather_code: number;
  wind_speed_10m: number;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function errorCode(value: unknown): string | undefined {
  return value instanceof LiveToolError ? value.code : asRecord(value)?.code as string | undefined;
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const normalized = ip.toLowerCase();
    return normalized === '::1'
      || normalized.startsWith('::ffff:')
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:');
  }

  const [first, second = Number.NaN] = ip.split('.').map(Number);
  return first === 10
    || first === 127
    || first === 0
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function validTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function validLocation(location: unknown): location is Location & { timezone?: { id?: unknown } } {
  const value = asRecord(location);
  return value?.success !== false
    && typeof value?.city === 'string'
    && value.city.trim().length > 0
    && typeof value.latitude === 'number'
    && Number.isFinite(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && typeof value.longitude === 'number'
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180;
}

function validGeocodingLocation(location: unknown): location is GeocodingLocation {
  const value = asRecord(location);
  return typeof value?.name === 'string'
    && value.name.trim().length > 0
    && typeof value.latitude === 'number'
    && Number.isFinite(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && typeof value.longitude === 'number'
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180
    && validTimeZone(value.timezone);
}

function validWeather(current: unknown, utcOffsetSeconds: unknown): current is WeatherCurrent {
  const value = asRecord(current);
  if (!value) return false;
  return typeof value.time === 'string'
    && typeof utcOffsetSeconds === 'number'
    && Number.isFinite(utcOffsetSeconds)
    && typeof value.temperature_2m === 'number'
    && Number.isFinite(value.temperature_2m)
    && typeof value.apparent_temperature === 'number'
    && Number.isFinite(value.apparent_temperature)
    && typeof value.weather_code === 'number'
    && Number.isFinite(value.weather_code)
    && typeof value.wind_speed_10m === 'number'
    && Number.isFinite(value.wind_speed_10m);
}

function toObservedAt(currentTime: string, utcOffsetSeconds: number): Date | null {
  const localTimeMs = Date.parse(`${currentTime}Z`);
  if (Number.isNaN(localTimeMs)) return null;
  return new Date(localTimeMs - (utcOffsetSeconds * 1000));
}

function isFetchResponse(value: unknown): value is FetchResponseLike {
  return value !== null && typeof value === 'object' && 'ok' in value;
}

async function fetchJson(fetchImpl: FetchLike, url: string, timeoutMs = TIMEOUT_MS, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new LiveToolError('request_aborted');
  const controller = new AbortController();
  let timeoutId;
  let removeAbortListener = () => {};
  const cancelled: Promise<{ aborted: true }> = new Promise((resolve) => {
    const abort = () => {
      controller.abort();
      resolve({ aborted: true });
    };
    signal?.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => signal?.removeEventListener('abort', abort);
  });
  const timeout: Promise<{ timedOut: true }> = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });

  try {
    const response: FetchResponseLike | { aborted: true } | { timedOut: true } = await Promise.race([
      fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal }),
      timeout,
      cancelled
    ]);
    if ('aborted' in response && response.aborted) throw new LiveToolError('request_aborted');
    if ('timedOut' in response && response.timedOut) throw new LiveToolError('timeout');
    if (!isFetchResponse(response) || !response.ok || typeof response.json !== 'function') throw new LiveToolError('unavailable');

    const body: unknown | { aborted: true } | { timedOut: true } = await Promise.race([response.json(), timeout, cancelled]);
    if (typeof body === 'object' && body !== null && 'aborted' in body && body.aborted) throw new LiveToolError('request_aborted');
    if (typeof body === 'object' && body !== null && 'timedOut' in body && body.timedOut) throw new LiveToolError('timeout');
    return body;
  } catch (error) {
    if (error instanceof LiveToolError) throw error;
    if (signal?.aborted) throw new LiveToolError('request_aborted');
    throw new LiveToolError('unavailable');
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener();
  }
}

export function isLiveDataRequest(content: unknown): content is string {
  return typeof content === 'string' && LIVE_INTENT.test(content);
}

export function isWeatherRequest(content: unknown): content is string {
  return typeof content === 'string' && WEATHER_INTENT.test(content);
}

export function isNewsRequest(content: unknown): content is string {
  return typeof content === 'string' && NEWS_INTENT.test(content);
}

export function formatLocalDate(now: Date, timeZone: unknown): string {
  const resolvedTimeZone = validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildGeoUrl(ip: string): string {
  if (isIP(ip) && !isPrivateIp(ip)) return `${GEO_ORIGIN}/${encodeURIComponent(ip)}`;
  return `${GEO_ORIGIN}/`;
}

export function buildGeocodingUrl(city: string): string {
  const params = new URLSearchParams({ name: city, count: '1', language: 'zh', format: 'json' });
  return `${GEOCODING_ORIGIN}?${params}`;
}

export function extractRequestedCity(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  const match = content.match(/([\u4e00-\u9fff]{2,12}?)(?:市)?(?:(?:今天|今日|当前|现在|实时|最新)(?:的)?)?(?:天气|气温|降雨|台风|风力|湿度)/u);
  const city = match?.[1] ?? null;
  return /^(今天|今日|当前|现在|实时|最新)$/.test(city ?? '') ? null : city;
}

export function buildWeatherUrl(latitude: number, longitude: number, timeZone: unknown): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m'
  });
  return `${WEATHER_ORIGIN}?${params}`;
}

export async function resolveLiveContext({
  ip,
  content,
  fetchImpl = fetch,
  now = () => new Date(),
  signal
}: { ip?: string; content?: string; fetchImpl?: FetchLike; now?: () => Date; signal?: AbortSignal } = {}) {
  if (signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
  if (!isLiveDataRequest(content)) return { ok: true, date: formatLocalDate(now(), DEFAULT_TIME_ZONE) };

  const serverNow = now();
  const serverTime = serverNow instanceof Date && !Number.isNaN(serverNow.getTime()) ? serverNow : new Date();

  const requestedCity = isWeatherRequest(content) ? extractRequestedCity(content) : null;
  const builtInLocation = requestedCity ? BUILT_IN_CITY_LOCATIONS.get(requestedCity) : null;
  if (!requestedCity && (typeof ip !== 'string' || !isIP(ip))) {
    return { ok: false, errorCode: 'invalid_client_ip' };
  }
  let location: Location;
  let timeZone: string;
  try {
    if (builtInLocation) {
      location = {
        city: builtInLocation.city,
        latitude: builtInLocation.latitude,
        longitude: builtInLocation.longitude
      };
      timeZone = builtInLocation.timeZone;
    } else if (requestedCity) {
      const geocoding = await fetchJson(fetchImpl, buildGeocodingUrl(requestedCity), TIMEOUT_MS, signal);
      const geocodingRecord = asRecord(geocoding);
      const result = Array.isArray(geocodingRecord?.results) ? geocodingRecord.results[0] : undefined;
      if (!validGeocodingLocation(result)) return { ok: false, errorCode: 'location_unavailable' };
      location = { city: result.name.trim(), latitude: result.latitude, longitude: result.longitude };
      timeZone = result.timezone;
    } else {
      const ipLocation = await fetchJson(fetchImpl, buildGeoUrl(ip ?? ''), TIMEOUT_MS, signal);
      if (!validLocation(ipLocation)) return { ok: false, errorCode: 'location_unavailable' };
      location = { city: ipLocation.city.trim(), latitude: ipLocation.latitude, longitude: ipLocation.longitude };
      const timezone = asRecord(ipLocation.timezone);
      timeZone = validTimeZone(timezone?.id) ? timezone.id : DEFAULT_TIME_ZONE;
    }
  } catch (error) {
    if (errorCode(error) === 'request_aborted' || signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
    return { ok: false, errorCode: 'location_unavailable' };
  }

  const date = formatLocalDate(serverTime, timeZone);
  const resolved = { ok: true, serverTime: serverTime.toISOString(), date, timeZone, location: location.city };
  if (!isWeatherRequest(content)) return resolved;

  let weather: unknown;
  try {
    weather = await fetchJson(fetchImpl, buildWeatherUrl(location.latitude, location.longitude, timeZone), TIMEOUT_MS, signal);
  } catch (error) {
    if (errorCode(error) === 'request_aborted' || signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
    return { ok: false, errorCode: 'weather_unavailable', date, timeZone, location: location.city };
  }
  const weatherRecord = asRecord(weather);
  const current = weatherRecord?.current;
  const utcOffsetSeconds = weatherRecord?.utc_offset_seconds;
  if (!validWeather(current, utcOffsetSeconds)) {
    return { ok: false, errorCode: 'weather_unavailable', date, timeZone, location: location.city };
  }
  const observedAt = toObservedAt(current.time, utcOffsetSeconds as number);
  if (!observedAt || observedAt.getTime() > serverTime.getTime() + 300000) {
    return { ok: false, errorCode: 'weather_unavailable', date, timeZone, location: location.city.trim() };
  }

  return {
    ...resolved,
    weather: {
      city: location.city,
      observedAt: observedAt.toISOString(),
      timeZone,
      ageSeconds: Math.max(0, Math.floor((serverTime.getTime() - observedAt.getTime()) / 1000)),
      temperatureC: current.temperature_2m,
      apparentTemperatureC: current.apparent_temperature,
      weatherCode: current.weather_code,
      windSpeedKph: current.wind_speed_10m,
      source: 'open-meteo'
    }
  };
}
