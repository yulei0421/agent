import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGeoUrl,
  buildWeatherUrl,
  formatLocalDate,
  isLiveDataRequest,
  isWeatherRequest,
  resolveLiveContext
} from '../server/tools/live.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status === 200,
    status,
    json: async () => body
  };
}

test('recognizes only weather or explicit current-information intent', () => {
  assert.equal(isLiveDataRequest('今天北京天气如何'), true);
  assert.equal(isLiveDataRequest('AAPL 最新价格'), true);
  assert.equal(isLiveDataRequest('解释什么是债券'), false);
  assert.equal(isWeatherRequest('今天北京天气如何'), true);
  assert.equal(isWeatherRequest('今天平安银行新闻'), false);
});

test('renders today using the resolved IANA timezone', () => {
  const now = new Date('2026-07-20T00:30:00.000Z');
  assert.equal(formatLocalDate(now, 'Asia/Shanghai'), '2026-07-20');
  assert.equal(formatLocalDate(now, 'America/Los_Angeles'), '2026-07-19');
});

test('builds geo and weather URLs from fixed providers only', () => {
  assert.equal(new URL(buildGeoUrl('203.0.113.10')).href, 'https://ipwho.is/203.0.113.10');
  assert.equal(new URL(buildGeoUrl('127.0.0.1')).href, 'https://ipwho.is/');

  const weather = new URL(buildWeatherUrl(31.23, 121.47, 'Asia/Shanghai'));
  assert.equal(weather.origin + weather.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(weather.searchParams.get('latitude'), '31.23');
  assert.equal(weather.searchParams.get('longitude'), '121.47');
  assert.equal(weather.searchParams.get('timezone'), 'Asia/Shanghai');
  assert.equal(weather.searchParams.get('current'), 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m');
});

test('resolves an IP location and normalizes a live weather snapshot from fixed providers', async () => {
  const requestedOrigins = [];
  const result = await resolveLiveContext({
    ip: '203.0.113.10',
    content: '今天天气怎么样？',
    now: () => new Date('2026-07-20T01:00:00.000Z'),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requestedOrigins.push(parsed.origin);
      if (parsed.origin === 'https://ipwho.is') {
        return jsonResponse({
          success: true,
          city: 'Shanghai',
          latitude: 31.23,
          longitude: 121.47,
          timezone: { id: 'Asia/Shanghai' }
        });
      }
      return jsonResponse({
        utc_offset_seconds: 28800,
        current: {
          time: '2026-07-20T09:00',
          temperature_2m: 31.2,
          apparent_temperature: 35,
          weather_code: 2,
          wind_speed_10m: 12
        }
      });
    }
  });

  assert.deepEqual(requestedOrigins, ['https://ipwho.is', 'https://api.open-meteo.com']);
  assert.deepEqual(result, {
    ok: true,
    serverTime: '2026-07-20T01:00:00.000Z',
    date: '2026-07-20',
    timeZone: 'Asia/Shanghai',
    location: 'Shanghai',
    weather: {
      city: 'Shanghai',
      observedAt: '2026-07-20T01:00:00.000Z',
      timeZone: 'Asia/Shanghai',
      ageSeconds: 0,
      temperatureC: 31.2,
      apparentTemperatureC: 35,
      weatherCode: 2,
      windSpeedKph: 12,
      source: 'open-meteo'
    }
  });
});

test('uses geocoding for a requested city outside the built-in location list', async () => {
  const requestedUrls = [];
  const result = await resolveLiveContext({
    ip: '203.0.113.10',
    content: '北京今天天气怎么样？',
    now: () => new Date('2026-07-20T01:00:00.000Z'),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requestedUrls.push(parsed);
      if (parsed.origin === 'https://geocoding-api.open-meteo.com') {
        return jsonResponse({
          results: [{ name: '北京', latitude: 39.9042, longitude: 116.4074, timezone: 'Asia/Shanghai' }]
        });
      }
      return jsonResponse({
        utc_offset_seconds: 28800,
        current: {
          time: '2026-07-20T09:00',
          temperature_2m: 31.2,
          apparent_temperature: 35,
          weather_code: 2,
          wind_speed_10m: 12
        }
      });
    }
  });

  assert.deepEqual(requestedUrls.map((url) => url.origin), [
    'https://geocoding-api.open-meteo.com',
    'https://api.open-meteo.com'
  ]);
  assert.equal(requestedUrls[0].searchParams.get('name'), '北京');
  assert.equal(requestedUrls[1].searchParams.get('latitude'), '39.9042');
  assert.equal(requestedUrls[1].searchParams.get('longitude'), '116.4074');
  assert.equal(requestedUrls[1].searchParams.get('timezone'), 'Asia/Shanghai');
  assert.equal(result.location, '北京');
  assert.equal(result.weather.city, '北京');
});

test('uses Shanghai coordinates when geocoding or client IP is unavailable', async () => {
  const requestedUrls = [];
  const result = await resolveLiveContext({
    ip: '',
    content: '上海今天天气怎么样？',
    now: () => new Date('2026-07-20T06:00:00.000Z'),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requestedUrls.push(parsed);
      return jsonResponse({
        utc_offset_seconds: 28800,
        current: {
          time: '2026-07-20T14:00',
          temperature_2m: 33.8,
          apparent_temperature: 39.6,
          weather_code: 3,
          wind_speed_10m: 6.4
        }
      });
    }
  });

  assert.deepEqual(requestedUrls.map((url) => url.origin), ['https://api.open-meteo.com']);
  assert.equal(requestedUrls[0].searchParams.get('latitude'), '31.22222');
  assert.equal(requestedUrls[0].searchParams.get('longitude'), '121.45806');
  assert.equal(result.location, '上海');
  assert.equal(result.weather.temperatureC, 33.8);
});

test('uses the resolved location timezone for current non-weather questions', async () => {
  const result = await resolveLiveContext({
    ip: '203.0.113.10',
    content: '今天平安银行有什么新闻？',
    now: () => new Date('2026-07-20T00:30:00.000Z'),
    fetchImpl: async () => jsonResponse({
      success: true,
      city: 'Los Angeles',
      latitude: 34.05,
      longitude: -118.24,
      timezone: { id: 'America/Los_Angeles' }
    })
  });

  assert.deepEqual(result, {
    ok: true,
    serverTime: '2026-07-20T00:30:00.000Z',
    date: '2026-07-19',
    timeZone: 'America/Los_Angeles',
    location: 'Los Angeles'
  });
});

test('rejects unsafe client IPs and reports upstream failures without returning invented weather', async () => {
  let calls = 0;
  const invalidIp = await resolveLiveContext({
    ip: '127.0.0.1,evil',
    content: '今天天气',
    fetchImpl: async () => { calls += 1; }
  });

  assert.deepEqual(invalidIp, { ok: false, errorCode: 'invalid_client_ip' });
  assert.equal(calls, 0);

  const failedLocation = await resolveLiveContext({
    ip: '203.0.113.10',
    content: '今天天气',
    fetchImpl: async () => jsonResponse({ success: false }, 429)
  });
  assert.deepEqual(failedLocation, { ok: false, errorCode: 'location_unavailable' });
});
