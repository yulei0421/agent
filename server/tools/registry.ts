import { isIP } from 'node:net';
import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolExecutionResult, ToolRegistry } from '../types.js';

const OMIT = Symbol('omit');
type OmitValue = typeof OMIT;
type UnknownRecord = Record<string, unknown>;
type ToolName = 'get_weather' | 'search_news' | 'search_asset' | 'get_quote';
type FieldRule = { maxLength: number; required: boolean };
type ToolContract = { description: string; fields: Record<string, FieldRule> };
type Normalizer = (value: unknown) => unknown | OmitValue;

interface LiveContextInput {
  ip: string;
  content: string;
  now: () => Date;
  signal?: AbortSignal;
}

interface RegistryDependencies {
  liveContext?: (input: LiveContextInput) => Promise<UnknownRecord | undefined>;
  webSearch?: (query: string, options: { now: Date; signal?: AbortSignal }) => Promise<UnknownRecord | undefined>;
  assetSearch?: (query: string, options: { signal?: AbortSignal }) => Promise<unknown>;
  marketGateway?: {
    getQuote(symbol: string, options: { signal?: AbortSignal }): Promise<UnknownRecord | undefined>;
  };
  now?: () => Date;
}

type ParsedCall =
  | { ok: true; name: ToolName; arguments: Record<string, string> }
  | { ok: false; name: string; errorCode: string };
type ToolFailure = Extract<ToolExecutionResult, { ok: false }>;

const TOOL_CONTRACTS: Readonly<Record<ToolName, ToolContract>> = Object.freeze({
  get_weather: {
    description: '查询指定城市或当前用户所在地的实时天气。',
    fields: { city: { maxLength: 64, required: false } }
  },
  search_news: {
    description: '检索与查询主题相关的近期新闻和报道。',
    fields: { query: { maxLength: 120, required: true } }
  },
  search_asset: {
    description: '根据名称或代码查找可查询行情的金融资产。',
    fields: { query: { maxLength: 64, required: true } }
  },
  get_quote: {
    description: '查询已确认市场代码的最新报价和数据时间。',
    fields: { symbol: { maxLength: 32, required: true } }
  }
});

const TOOL_DEFINITIONS: readonly ToolDefinition[] = Object.freeze(
  (Object.entries(TOOL_CONTRACTS) as [ToolName, ToolContract][]).map<ToolDefinition>(([name, contract]) => ({
    type: 'function',
    function: {
      name,
      description: contract.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(contract.fields).map(([field, rule]) => [field, { type: 'string', maxLength: rule.maxLength }])
        ),
        ...(Object.values(contract.fields).some((rule) => rule.required)
          ? { required: Object.entries(contract.fields).filter(([, rule]) => rule.required).map(([field]) => field) }
          : {}),
        additionalProperties: false
      }
    }
  }))
);

function isToolName(value: string): value is ToolName {
  return Object.hasOwn(TOOL_CONTRACTS, value);
}

function failure(name: unknown, errorCode: string): ToolFailure {
  return { ok: false, name: safeResultString(name) ? name : 'unknown', errorCode };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted);
}

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCall(call: ToolCall): ParsedCall {
  const name = call.name;
  if (!isToolName(name)) return failure(name, 'unknown_tool');

  let argumentsValue: unknown;
  try {
    argumentsValue = JSON.parse(call.arguments) as unknown;
  } catch {
    return failure(name, 'invalid_arguments');
  }
  if (!isObject(argumentsValue)) return failure(name, 'invalid_arguments');

  const contract = TOOL_CONTRACTS[name];
  const keys = Object.keys(argumentsValue);
  if (keys.some((key) => !Object.hasOwn(contract.fields, key))) return failure(name, 'invalid_arguments');
  for (const [key, rule] of Object.entries(contract.fields)) {
    const value = argumentsValue[key];
    if ((rule.required && !Object.hasOwn(argumentsValue, key))
      || (Object.hasOwn(argumentsValue, key)
        && (typeof value !== 'string' || value.trim().length === 0 || value.length > rule.maxLength))) {
      return failure(name, 'invalid_arguments');
    }
  }
  return { ok: true, name, arguments: argumentsValue as Record<string, string> };
}

function errorCode(value: unknown): string | undefined {
  return isObject(value) && typeof value.code === 'string' ? value.code : undefined;
}

function safeErrorCode(value: unknown, fallback: string): string {
  return safeResultString(value) && value.length <= 100 ? value : fallback;
}

function hasIpLiteral(value: string): boolean {
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

function safeResultString(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  return !/(?:^|[^\p{L}\p{N}])[A-Za-z][A-Za-z0-9+.-]*:\/{1,2}\S/u.test(value)
    && !/(?:^|[^\p{L}\p{N}])(?:data|mailto|tel|urn|javascript):\S/iu.test(value)
    && !/\bwww\./iu.test(value)
    && !hasIpLiteral(value);
}

function text(value: unknown, maxLength = 200): string | OmitValue {
  return safeResultString(value) && value.length <= maxLength ? value : OMIT;
}

function stableId(value: unknown, maxLength = 128): string | OmitValue {
  const normalized = text(value, maxLength);
  return normalized !== OMIT && /^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(normalized) ? normalized : OMIT;
}

function isoTimestamp(value: unknown): string | OmitValue {
  const normalized = text(value, 40);
  if (normalized === OMIT) return OMIT;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === normalized ? normalized : OMIT;
}

function localDate(value: unknown): string | OmitValue {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return OMIT;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().startsWith(value) ? value : OMIT;
}

function boundedNumber(value: unknown, min: number, max: number, integer = false): number | OmitValue {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max
    && (!integer || Number.isInteger(value))
    ? value
    : OMIT;
}

function strictBoolean(value: unknown): boolean | OmitValue {
  return typeof value === 'boolean' ? value : OMIT;
}

function normalizeFields(value: unknown, normalizers: Record<string, Normalizer>): UnknownRecord {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(normalizers)
      .filter(([field]) => Object.hasOwn(value, field))
      .map(([field, normalize]) => [field, normalize(value[field])])
      .filter(([, normalized]) => normalized !== OMIT)
  );
}

function resolvedDate(value: unknown): Date {
  const candidate = typeof value === 'function' ? value() : value;
  return candidate instanceof Date && !Number.isNaN(candidate.getTime()) ? candidate : new Date();
}

function normalizeNews(response: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = {};
  if (Array.isArray(response.sources)) {
    result.sources = response.sources
      .filter(isObject)
      .map((source) => normalizeFields(source, {
        title: (value) => text(value, 300),
        publisher: (value) => text(value, 160),
        publishedAt: isoTimestamp
      }));
  }
  Object.assign(result, normalizeFields(response, {
    serverTime: isoTimestamp,
    latestPublishedAt: isoTimestamp,
    latestAgeSeconds: (value) => boundedNumber(value, 0, 315360000)
  }));
  return result;
}

function normalizeWeather(response: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = {};
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
  Object.assign(result, normalizeFields(response, {
    location: (value) => text(value, 128),
    date: localDate,
    serverTime: isoTimestamp
  }));
  return result;
}

export function createToolRegistry({
  liveContext,
  webSearch,
  marketGateway,
  assetSearch,
  now = () => new Date()
}: RegistryDependencies = {}): ToolRegistry {
  async function execute(call: ToolCall, context: ToolExecutionContext = {}): Promise<ToolExecutionResult> {
    const parsed = parseCall(call);
    if (!parsed.ok) return parsed;
    if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');

    if (parsed.name === 'get_weather') {
      if (!liveContext) return failure(parsed.name, 'tool_unavailable');
      try {
        const response = await liveContext({
          ip: context.ip ?? '',
          content: parsed.arguments.city ? `${parsed.arguments.city}天气` : '天气',
          now: context.now ?? now,
          ...(context.signal ? { signal: context.signal } : {})
        });
        if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');
        if (!response?.ok) return failure(parsed.name, safeErrorCode(response?.errorCode, 'weather_unavailable'));
        return { ok: true, name: parsed.name, result: normalizeWeather(response) };
      } catch (caught) {
        if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');
        return failure(parsed.name, safeErrorCode(errorCode(caught), 'weather_unavailable'));
      }
    }

    if (parsed.name === 'search_news') {
      if (!webSearch) return failure(parsed.name, 'tool_unavailable');
      try {
        const response = await webSearch(parsed.arguments.query ?? '', {
          now: resolvedDate(context.now ?? now),
          signal: context.signal
        });
        if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');
        if (!response?.ok) return failure(parsed.name, safeErrorCode(response?.errorCode, 'news_unavailable'));
        return { ok: true, name: parsed.name, result: normalizeNews(response) };
      } catch (caught) {
        if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');
        return failure(parsed.name, safeErrorCode(errorCode(caught), 'news_unavailable'));
      }
    }

    if (parsed.name === 'search_asset') {
      if (!assetSearch) return failure(parsed.name, 'not_found');
      try {
        const assets = await assetSearch(parsed.arguments.query ?? '', { signal: context.signal });
        if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');
        if (isObject(assets) && assets.errorCode === 'request_aborted') return failure(parsed.name, 'request_aborted');
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
        return result.length > 0 ? { ok: true, name: parsed.name, result } : failure(parsed.name, 'not_found');
      } catch {
        if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');
        return failure(parsed.name, 'not_found');
      }
    }

    if (!marketGateway) return failure(parsed.name, 'tool_unavailable');
    try {
      const response = await marketGateway.getQuote(parsed.arguments.symbol ?? '', { signal: context.signal });
      if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');
      if (!response?.ok) return failure(parsed.name, safeErrorCode(isObject(response?.error) ? response.error.code : undefined, 'provider_unavailable'));
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
    } catch (caught) {
      if (isAborted(context.signal)) return failure(parsed.name, 'request_aborted');
      return failure(parsed.name, safeErrorCode(errorCode(caught), 'provider_unavailable'));
    }
  }

  return { definitions: () => TOOL_DEFINITIONS, execute };
}
