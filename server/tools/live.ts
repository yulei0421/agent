import { isIP } from 'node:net';

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
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function isPrivateIp(ip) {
  if (ip.includes(':')) {
    const normalized = ip.toLowerCase();
    return normalized === '::1'
      || normalized.startsWith('::ffff:')
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:');
  }

  const [first, second] = ip.split('.').map(Number);
  return first === 10
    || first === 127
    || first === 0
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function validTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function validLocation(location) {
  return location?.success !== false
    && typeof location?.city === 'string'
    && location.city.trim().length > 0
    && Number.isFinite(location.latitude)
    && location.latitude >= -90
    && location.latitude <= 90
    && Number.isFinite(location.longitude)
    && location.longitude >= -180
    && location.longitude <= 180;
}

function validGeocodingLocation(location) {
  return typeof location?.name === 'string'
    && location.name.trim().length > 0
    && Number.isFinite(location.latitude)
    && location.latitude >= -90
    && location.latitude <= 90
    && Number.isFinite(location.longitude)
    && location.longitude >= -180
    && location.longitude <= 180
    && validTimeZone(location.timezone);
}

function validWeather(current, utcOffsetSeconds) {
  return current
    && typeof current.time === 'string'
    && Number.isFinite(utcOffsetSeconds)
    && Number.isFinite(current.temperature_2m)
    && Number.isFinite(current.apparent_temperature)
    && Number.isFinite(current.weather_code)
    && Number.isFinite(current.wind_speed_10m);
}

function toObservedAt(currentTime, utcOffsetSeconds) {
  const localTimeMs = Date.parse(`${currentTime}Z`);
  if (Number.isNaN(localTimeMs)) return null;
  return new Date(localTimeMs - (utcOffsetSeconds * 1000));
}

async function fetchJson(fetchImpl, url, timeoutMs = TIMEOUT_MS, signal) {
  if (signal?.aborted) throw new LiveToolError('request_aborted');
  const controller = new AbortController();
  let timeoutId;
  let removeAbortListener = () => {};
  const cancelled = new Promise((resolve) => {
    const abort = () => {
      controller.abort();
      resolve({ aborted: true });
    };
    signal?.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => signal?.removeEventListener('abort', abort);
  });
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal }),
      timeout,
      cancelled
    ]);
    if (response?.aborted) throw new LiveToolError('request_aborted');
    if (response?.timedOut) throw new LiveToolError('timeout');
    if (!response?.ok || typeof response.json !== 'function') throw new LiveToolError('unavailable');

    const body = await Promise.race([response.json(), timeout, cancelled]);
    if (body?.aborted) throw new LiveToolError('request_aborted');
    if (body?.timedOut) throw new LiveToolError('timeout');
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

export function isLiveDataRequest(content) {
  return typeof content === 'string' && LIVE_INTENT.test(content);
}

export function isWeatherRequest(content) {
  return typeof content === 'string' && WEATHER_INTENT.test(content);
}

export function isNewsRequest(content) {
  return typeof content === 'string' && NEWS_INTENT.test(content);
}

export function formatLocalDate(now, timeZone) {
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

export function buildGeoUrl(ip) {
  if (isIP(ip) && !isPrivateIp(ip)) return `${GEO_ORIGIN}/${encodeURIComponent(ip)}`;
  return `${GEO_ORIGIN}/`;
}

export function buildGeocodingUrl(city) {
  const params = new URLSearchParams({ name: city, count: '1', language: 'zh', format: 'json' });
  return `${GEOCODING_ORIGIN}?${params}`;
}

export function extractRequestedCity(content) {
  if (typeof content !== 'string') return null;
  const match = content.match(/([\u4e00-\u9fff]{2,12}?)(?:市)?(?:(?:今天|今日|当前|现在|实时|最新)(?:的)?)?(?:天气|气温|降雨|台风|风力|湿度)/u);
  const city = match?.[1] ?? null;
  return /^(今天|今日|当前|现在|实时|最新)$/.test(city ?? '') ? null : city;
}

export function buildWeatherUrl(latitude, longitude, timeZone) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m'
  });
  return `${WEATHER_ORIGIN}?${params}`;
}

export async function resolveLiveContext({ ip, content, fetchImpl = fetch, now = () => new Date(), signal } = {}) {
  if (signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
  if (!isLiveDataRequest(content)) return { ok: true, date: formatLocalDate(now(), DEFAULT_TIME_ZONE) };

  const serverNow = now();
  const serverTime = serverNow instanceof Date && !Number.isNaN(serverNow.getTime()) ? serverNow : new Date();

  const requestedCity = isWeatherRequest(content) ? extractRequestedCity(content) : null;
  const builtInLocation = requestedCity ? BUILT_IN_CITY_LOCATIONS.get(requestedCity) : null;
  if (!requestedCity && (typeof ip !== 'string' || !isIP(ip))) {
    return { ok: false, errorCode: 'invalid_client_ip' };
  }
  let location;
  let timeZone;
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
      const result = geocoding?.results?.[0];
      if (!validGeocodingLocation(result)) return { ok: false, errorCode: 'location_unavailable' };
      location = { city: result.name.trim(), latitude: result.latitude, longitude: result.longitude };
      timeZone = result.timezone;
    } else {
      const ipLocation = await fetchJson(fetchImpl, buildGeoUrl(ip), TIMEOUT_MS, signal);
      if (!validLocation(ipLocation)) return { ok: false, errorCode: 'location_unavailable' };
      location = { city: ipLocation.city.trim(), latitude: ipLocation.latitude, longitude: ipLocation.longitude };
      timeZone = validTimeZone(ipLocation.timezone?.id) ? ipLocation.timezone.id : DEFAULT_TIME_ZONE;
    }
  } catch (error) {
    if (error?.code === 'request_aborted' || signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
    return { ok: false, errorCode: 'location_unavailable' };
  }

  const date = formatLocalDate(serverTime, timeZone);
  const resolved = { ok: true, serverTime: serverTime.toISOString(), date, timeZone, location: location.city };
  if (!isWeatherRequest(content)) return resolved;

  let weather;
  try {
    weather = await fetchJson(fetchImpl, buildWeatherUrl(location.latitude, location.longitude, timeZone), TIMEOUT_MS, signal);
  } catch (error) {
    if (error?.code === 'request_aborted' || signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
    return { ok: false, errorCode: 'weather_unavailable', date, timeZone, location: location.city };
  }
  if (!validWeather(weather?.current, weather?.utc_offset_seconds)) {
    return { ok: false, errorCode: 'weather_unavailable', date, timeZone, location: location.city };
  }
  const observedAt = toObservedAt(weather.current.time, weather.utc_offset_seconds);
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
      temperatureC: weather.current.temperature_2m,
      apparentTemperatureC: weather.current.apparent_temperature,
      weatherCode: weather.current.weather_code,
      windSpeedKph: weather.current.wind_speed_10m,
      source: 'open-meteo'
    }
  };
}
