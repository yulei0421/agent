import { isIP } from 'node:net';

const OMIT = Symbol('omit');

const TOOL_DEFINITIONS = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市或当前用户所在地的实时天气。',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', maxLength: 64 }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_news',
      description: '检索与查询主题相关的近期新闻和报道。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 120 }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_asset',
      description: '根据名称或代码查找可查询行情的金融资产。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 64 }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_quote',
      description: '查询已确认市场代码的最新报价和数据时间。',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', maxLength: 32 }
        },
        required: ['symbol'],
        additionalProperties: false
      }
    }
  }
]);

const TOOL_ARGUMENTS = Object.freeze({
  get_weather: { allowed: ['city'], limits: { city: 64 }, required: [] },
  search_news: { allowed: ['query'], limits: { query: 120 }, required: ['query'] },
  search_asset: { allowed: ['query'], limits: { query: 64 }, required: ['query'] },
  get_quote: { allowed: ['symbol'], limits: { symbol: 32 }, required: ['symbol'] }
});

function failure(name, errorCode) {
  return { ok: false, name: safeResultString(name) ? name : 'unknown', errorCode };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCall(call) {
  const name = call?.name;
  if (typeof name !== 'string' || !Object.hasOwn(TOOL_ARGUMENTS, name)) {
    return failure(name, 'unknown_tool');
  }
  if (typeof call?.arguments !== 'string') return failure(name, 'invalid_arguments');

  let argumentsValue;
  try {
    argumentsValue = JSON.parse(call.arguments);
  } catch {
    return failure(name, 'invalid_arguments');
  }
  if (!isObject(argumentsValue)) return failure(name, 'invalid_arguments');

  const schema = TOOL_ARGUMENTS[name];
  const keys = Object.keys(argumentsValue);
  if (keys.some((key) => !schema.allowed.includes(key))) return failure(name, 'invalid_arguments');
  for (const key of [...schema.required, ...keys]) {
    const value = argumentsValue[key];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > schema.limits[key]) {
      return failure(name, 'invalid_arguments');
    }
  }
  return { ok: true, name, arguments: argumentsValue };
}

function safeErrorCode(value, fallback) {
  return safeResultString(value) && value.length <= 100 ? value : fallback;
}

function hasIpLiteral(value) {
  const ipv4Literals = value.match(/\d{1,3}(?:\.\d{1,3}){3}/gu) ?? [];
  if (ipv4Literals.some((literal) => isIP(literal) !== 0)) return true;
  const tokens = value.match(/[0-9A-Fa-f:.]+/gu) ?? [];
  return tokens.some((token) => {
    if (isIP(token) !== 0) return true;
    for (let start = 0; start < token.length; start += 1) {
      const maxEnd = Math.min(token.length, start + 45);
      for (let end = start + 2; end <= maxEnd; end += 1) {
        const candidate = token.slice(start, end);
        if (candidate.includes(':') && isIP(candidate) === 6) return true;
      }
    }
    return false;
  });
}

function safeResultString(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  return !/(?:^|[^A-Za-z0-9])[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
    && !/\bwww\./iu.test(value)
    && !hasIpLiteral(value);
}

function text(value, maxLength = 200) {
  return safeResultString(value) && value.length <= maxLength ? value : OMIT;
}

function stableId(value, maxLength = 128) {
  return text(value, maxLength) !== OMIT && /^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(value) ? value : OMIT;
}

function isoTimestamp(value) {
  if (text(value, 40) === OMIT) return OMIT;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : OMIT;
}

function localDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? '')) return OMIT;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().startsWith(value) ? value : OMIT;
}

function boundedNumber(value, min, max, integer = false) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max
    && (!integer || Number.isInteger(value))
    ? value
    : OMIT;
}

function strictBoolean(value) {
  return typeof value === 'boolean' ? value : OMIT;
}

function normalizeFields(value, normalizers) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(normalizers)
    .filter(([field]) => Object.hasOwn(value, field))
    .map(([field, normalize]) => [field, normalize(value[field])])
    .filter(([, normalized]) => normalized !== OMIT));
}

function resolvedDate(value) {
  const candidate = typeof value === 'function' ? value() : value;
  return candidate instanceof Date && !Number.isNaN(candidate.getTime()) ? candidate : new Date();
}

function normalizeNews(response) {
  const result = {};
  if (Array.isArray(response.sources)) {
    result.sources = response.sources
      .filter(isObject)
      .map((source) => normalizeFields(source, {
        title: (value) => text(value, 300),
        publisher: (value) => text(value, 160),
        publishedAt: isoTimestamp
      }));
  }
  const metadata = normalizeFields(response, {
    serverTime: isoTimestamp,
    latestPublishedAt: isoTimestamp,
    latestAgeSeconds: (value) => boundedNumber(value, 0, 315360000)
  });
  Object.assign(result, metadata);
  return result;
}

function normalizeWeather(response) {
  const result = {};
  const weather = normalizeFields(response.weather, {
    city: (value) => text(value, 128),
    observedAt: isoTimestamp,
    timeZone: (value) => stableId(value, 64),
    ageSeconds: (value) => boundedNumber(value, 0, 315360000),
    temperatureC: (value) => boundedNumber(value, -100, 100),
    apparentTemperatureC: (value) => boundedNumber(value, -100, 100),
    weatherCode: (value) => boundedNumber(value, 0, 1000, true),
    windSpeedKph: (value) => boundedNumber(value, 0, 1000),
    source: (value) => stableId(value, 128)
  });
  if (Object.keys(weather).length > 0) result.weather = weather;
  const context = normalizeFields(response, {
    location: (value) => text(value, 128),
    date: localDate
  });
  Object.assign(result, context);
  return result;
}

export function createToolRegistry({
  liveContext,
  webSearch,
  marketGateway,
  assetSearch,
  now = () => new Date()
} = {}) {
  async function execute(call, context = {}) {
    const parsed = parseCall(call);
    if (!parsed.ok) return parsed;

    if (parsed.name === 'get_weather') {
      if (typeof liveContext !== 'function') return failure(parsed.name, 'tool_unavailable');
      try {
        const response = await liveContext({
          ip: context.ip ?? '',
          content: parsed.arguments.city ? `${parsed.arguments.city}天气` : '天气',
          now: context.now ?? now
        });
        if (!response?.ok) return failure(parsed.name, safeErrorCode(response?.errorCode, 'weather_unavailable'));
        return { ok: true, name: parsed.name, result: normalizeWeather(response) };
      } catch (error) {
        return failure(parsed.name, safeErrorCode(error?.code, 'weather_unavailable'));
      }
    }

    if (parsed.name === 'search_news') {
      if (typeof webSearch !== 'function') return failure(parsed.name, 'tool_unavailable');
      try {
        const response = await webSearch(parsed.arguments.query, { now: resolvedDate(context.now ?? now) });
        if (!response?.ok) return failure(parsed.name, safeErrorCode(response?.errorCode, 'news_unavailable'));
        return { ok: true, name: parsed.name, result: normalizeNews(response) };
      } catch (error) {
        return failure(parsed.name, safeErrorCode(error?.code, 'news_unavailable'));
      }
    }

    if (parsed.name === 'search_asset') {
      if (typeof assetSearch !== 'function') return failure(parsed.name, 'not_found');
      try {
        const assets = await assetSearch(parsed.arguments.query);
        if (!Array.isArray(assets)) return failure(parsed.name, 'not_found');
        const result = assets
          .filter(isObject)
          .map((asset) => normalizeFields(asset, {
            symbol: (value) => stableId(value, 64),
            name: (value) => text(value, 200),
            market: (value) => stableId(value, 32),
            type: (value) => stableId(value, 32),
            source: (value) => stableId(value, 128)
          }))
          .filter((asset) => Object.keys(asset).length > 0)
          .slice(0, 5);
        return result.length > 0
          ? { ok: true, name: parsed.name, result }
          : failure(parsed.name, 'not_found');
      } catch {
        return failure(parsed.name, 'not_found');
      }
    }

    if (!marketGateway || typeof marketGateway.getQuote !== 'function') {
      return failure(parsed.name, 'tool_unavailable');
    }
    try {
      const response = await marketGateway.getQuote(parsed.arguments.symbol);
      if (!response?.ok) return failure(parsed.name, safeErrorCode(response?.error?.code, 'provider_unavailable'));
      return {
        ok: true,
        name: parsed.name,
        result: {
          data: normalizeFields(response.data, {
            price: (value) => boundedNumber(value, 0, 1000000000000),
            changePercent: (value) => boundedNumber(value, -1000000, 1000000),
            currency: (value) => stableId(value, 16)
          }),
          meta: normalizeFields(response.meta, {
            source: (value) => stableId(value, 128),
            asOf: isoTimestamp,
            observedAt: isoTimestamp,
            fetchedAt: isoTimestamp,
            ageSeconds: (value) => boundedNumber(value, 0, 315360000),
            delay: (value) => stableId(value, 64),
            symbol: (value) => stableId(value, 64),
            confidence: (value) => stableId(value, 64),
            cached: strictBoolean
          })
        }
      };
    } catch (error) {
      return failure(parsed.name, safeErrorCode(error?.code, 'provider_unavailable'));
    }
  }

  return { definitions: () => TOOL_DEFINITIONS, execute };
}
