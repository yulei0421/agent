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

const WEATHER_FIELDS = Object.freeze([
  'city',
  'observedAt',
  'timeZone',
  'ageSeconds',
  'temperatureC',
  'apparentTemperatureC',
  'weatherCode',
  'windSpeedKph',
  'source'
]);
const QUOTE_DATA_FIELDS = Object.freeze(['price', 'changePercent', 'currency']);
const QUOTE_META_FIELDS = Object.freeze([
  'source',
  'asOf',
  'observedAt',
  'fetchedAt',
  'ageSeconds',
  'delay',
  'symbol',
  'confidence',
  'cached'
]);
const ASSET_FIELDS = Object.freeze(['symbol', 'name', 'market', 'type', 'source']);

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
  return value.match(/[0-9A-Fa-f:.]+/gu)?.some((token) => isIP(token) !== 0) ?? false;
}

function safeResultString(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  return !/(?:^|[^A-Za-z0-9])[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
    && !/\bwww\./iu.test(value)
    && !hasIpLiteral(value);
}

function sanitizeResultValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return safeResultString(value) ? value : OMIT;
  if (typeof value === 'number') return Number.isFinite(value) ? value : OMIT;
  if (typeof value === 'boolean' || value === null) return value;
  if (typeof value !== 'object' || seen.has(value)) return OMIT;
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeResultValue(item, seen))
      .filter((item) => item !== OMIT);
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => safeResultString(key))
    .map(([key, item]) => [key, sanitizeResultValue(item, seen)])
    .filter(([, item]) => item !== OMIT));
}

function pickFields(value, fields) {
  if (!isObject(value)) return {};
  return Object.fromEntries(fields
    .filter((field) => Object.hasOwn(value, field))
    .map((field) => [field, sanitizeResultValue(value[field])])
    .filter(([, fieldValue]) => fieldValue !== OMIT));
}

function pickStringFields(value, fields) {
  if (!isObject(value)) return {};
  return Object.fromEntries(fields
    .filter((field) => safeResultString(value[field]))
    .map((field) => [field, value[field]]));
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
      .map((source) => pickStringFields(source, ['title', 'publisher', 'publishedAt']));
  }
  for (const field of ['serverTime', 'latestPublishedAt']) {
    if (safeResultString(response[field])) result[field] = response[field];
  }
  if (Number.isFinite(response.latestAgeSeconds)) result.latestAgeSeconds = response.latestAgeSeconds;
  return result;
}

function normalizeWeather(response) {
  const result = {};
  const weather = pickFields(response.weather, WEATHER_FIELDS);
  if (Object.keys(weather).length > 0) result.weather = weather;
  if (safeResultString(response.location)) result.location = response.location;
  if (safeResultString(response.date)) result.date = response.date;
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
          .map((asset) => pickStringFields(asset, ASSET_FIELDS))
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
          data: pickFields(response.data, QUOTE_DATA_FIELDS),
          meta: pickFields(response.meta, QUOTE_META_FIELDS)
        }
      };
    } catch (error) {
      return failure(parsed.name, safeErrorCode(error?.code, 'provider_unavailable'));
    }
  }

  return { definitions: () => TOOL_DEFINITIONS, execute };
}
