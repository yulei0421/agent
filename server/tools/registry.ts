import { isIP } from 'node:net';
import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../domain/tools/tool.types.js';
import type { ToolManifest, ToolManifestRegistry } from '../domain/tools/tool.types.js';
import type { EconomicCalendarResult } from '../economic-calendar/gateway.js';

const OMIT = Symbol('omit');
type OmitValue = typeof OMIT;
type UnknownRecord = Record<string, unknown>;
type ToolName = 'get_weather' | 'search_news' | 'search_asset' | 'get_quote' | 'get_technical_indicators' | 'get_economic_calendar';
type Normalizer = (value: unknown) => unknown | OmitValue;

interface LiveContextInput {
  ip: string;
  content: string;
  now: () => Date;
  signal?: AbortSignal;
}

export interface RegistryDependencies {
  liveContext?: (input: LiveContextInput) => Promise<UnknownRecord | undefined>;
  webSearch?: (query: string, options: { now: Date; signal?: AbortSignal }) => Promise<UnknownRecord | undefined>;
  assetSearch?: (query: string, options: { signal?: AbortSignal }) => Promise<unknown>;
  marketGateway?: {
    getQuote?(symbol: string, options: { signal?: AbortSignal }): Promise<UnknownRecord | undefined>;
    getCandles?(symbol: string, options: { interval?: string; range?: string; signal?: AbortSignal }): Promise<UnknownRecord | undefined>;
  };
  economicCalendar?: (options: { signal?: AbortSignal }) => Promise<EconomicCalendarResult>;
  now?: () => Date;
  timeoutScheduler?: TimeoutScheduler;
}

interface TimeoutScheduler {
  setTimeout(callback: () => void, timeoutMs: number): ReturnType<typeof globalThis.setTimeout>;
  clearTimeout(timeout: ReturnType<typeof globalThis.setTimeout>): void;
}

type ParsedCall =
  | { ok: true; manifest: ToolManifest; arguments: Record<string, string> }
  | { ok: false; name: string; errorCode: string };
type ToolFailure = Extract<ToolExecutionResult, { ok: false }>;

function failure(name: unknown, errorCode: string): ToolFailure {
  return { ok: false, name: safeResultString(name) ? name : 'unknown', errorCode };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted);
}

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCall(call: ToolCall, manifests: readonly ToolManifest[]): ParsedCall {
  const name = call.name;
  const manifest = manifests.find((candidate) => candidate.name === name);
  if (!manifest) return failure(name, 'unknown_tool');

  let argumentsValue: unknown;
  try {
    argumentsValue = JSON.parse(call.arguments) as unknown;
  } catch {
    return failure(name, 'invalid_arguments');
  }
  if (!isObject(argumentsValue)) return failure(name, 'invalid_arguments');

  const { parameters } = manifest.definition.function;
  const keys = Object.keys(argumentsValue);
  if (keys.some((key) => !Object.hasOwn(parameters.properties, key))) return failure(name, 'invalid_arguments');
  for (const [key, rule] of Object.entries(parameters.properties)) {
    const value = argumentsValue[key];
    if (((parameters.required?.includes(key) ?? false) && !Object.hasOwn(argumentsValue, key))
      || (Object.hasOwn(argumentsValue, key)
        && (typeof value !== 'string' || value.trim().length === 0 || value.length > rule.maxLength))) {
      return failure(name, 'invalid_arguments');
    }
  }
  return { ok: true, manifest, arguments: argumentsValue as Record<string, string> };
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
        citationId: (value) => stableId(value, 32),
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

const TOOL_TIMEOUT_MS = 10_000;

function definition(name: ToolName, description: string, properties: ToolDefinition['function']['parameters']['properties'], required: string[] = []): ToolDefinition {
  const frozenProperties = Object.fromEntries(
    Object.entries(properties).map(([field, rule]) => [field, Object.freeze({ ...rule })])
  );
  return Object.freeze({
    type: 'function' as const,
    function: Object.freeze({
      name,
      description,
      parameters: Object.freeze({
        type: 'object' as const,
        properties: Object.freeze(frozenProperties),
        ...(required.length > 0 ? { required: Object.freeze(required) } : {}),
        additionalProperties: false as const
      })
    })
  });
}

async function executeWeather(call: ToolCall, context: ToolExecutionContext, dependencies: RegistryDependencies): Promise<ToolExecutionResult> {
  const { liveContext, now = () => new Date() } = dependencies;
  if (!liveContext) return failure('get_weather', 'tool_unavailable');
  try {
    const argumentsValue = JSON.parse(call.arguments) as Record<string, string>;
    const response = await liveContext({ ip: context.ip ?? '', content: argumentsValue.city ? `${argumentsValue.city}天气` : '天气', now: context.now ?? now, signal: context.signal });
    if (isAborted(context.signal)) return failure('get_weather', 'request_aborted');
    if (!response?.ok) return failure('get_weather', safeErrorCode(response?.errorCode, 'weather_unavailable'));
    return { ok: true, name: 'get_weather', result: normalizeWeather(response) };
  } catch (caught) {
    return isAborted(context.signal) ? failure('get_weather', 'request_aborted') : failure('get_weather', safeErrorCode(errorCode(caught), 'weather_unavailable'));
  }
}

async function executeNews(call: ToolCall, context: ToolExecutionContext, dependencies: RegistryDependencies): Promise<ToolExecutionResult> {
  const { webSearch, now = () => new Date() } = dependencies;
  if (!webSearch) return failure('search_news', 'tool_unavailable');
  try {
    const argumentsValue = JSON.parse(call.arguments) as Record<string, string>;
    const response = await webSearch(argumentsValue.query ?? '', { now: resolvedDate(context.now ?? now), signal: context.signal });
    if (isAborted(context.signal)) return failure('search_news', 'request_aborted');
    if (!response?.ok) return failure('search_news', safeErrorCode(response?.errorCode, 'news_unavailable'));
    return { ok: true, name: 'search_news', result: normalizeNews(response) };
  } catch (caught) {
    return isAborted(context.signal) ? failure('search_news', 'request_aborted') : failure('search_news', safeErrorCode(errorCode(caught), 'news_unavailable'));
  }
}

async function executeAssetSearch(call: ToolCall, context: ToolExecutionContext, dependencies: RegistryDependencies): Promise<ToolExecutionResult> {
  const { assetSearch } = dependencies;
  if (!assetSearch) return failure('search_asset', 'not_found');
  try {
    const argumentsValue = JSON.parse(call.arguments) as Record<string, string>;
    const assets = await assetSearch(argumentsValue.query ?? '', { signal: context.signal });
    if (isAborted(context.signal)) return failure('search_asset', 'request_aborted');
    if (isObject(assets) && assets.errorCode === 'request_aborted') return failure('search_asset', 'request_aborted');
    if (!Array.isArray(assets)) return failure('search_asset', 'not_found');
    const result = assets.filter(isObject).map((asset) => normalizeFields(asset, {
      symbol: (value) => stableId(value, 64), name: (value) => text(value, 200), market: (value) => stableId(value, 32), type: (value) => stableId(value, 32), source: (value) => stableId(value, 128)
    })).filter((asset) => Object.keys(asset).length > 0).slice(0, 5);
    return result.length > 0 ? { ok: true, name: 'search_asset', result } : failure('search_asset', 'not_found');
  } catch {
    return isAborted(context.signal) ? failure('search_asset', 'request_aborted') : failure('search_asset', 'not_found');
  }
}

async function executeQuote(call: ToolCall, context: ToolExecutionContext, dependencies: RegistryDependencies): Promise<ToolExecutionResult> {
  const { marketGateway } = dependencies;
  if (!marketGateway?.getQuote) return failure('get_quote', 'tool_unavailable');
  try {
    const argumentsValue = JSON.parse(call.arguments) as Record<string, string>;
    const response = await marketGateway.getQuote(argumentsValue.symbol ?? '', { signal: context.signal });
    if (isAborted(context.signal)) return failure('get_quote', 'request_aborted');
    if (!response?.ok) return failure('get_quote', safeErrorCode(isObject(response?.error) ? response.error.code : undefined, 'provider_unavailable'));
    return { ok: true, name: 'get_quote', result: {
      data: normalizeFields(response.data, { price: (value) => boundedNumber(value, 0, 1000000000000), changePercent: (value) => boundedNumber(value, -1000000, 1000000), currency: (value) => stableId(value, 16) }),
      meta: normalizeFields(response.meta, { source: (value) => stableId(value, 128), asOf: isoTimestamp, observedAt: isoTimestamp, fetchedAt: isoTimestamp, ageSeconds: (value) => boundedNumber(value, 0, 315360000), delay: (value) => stableId(value, 64), symbol: (value) => stableId(value, 64), confidence: (value) => stableId(value, 64), cached: strictBoolean })
    } };
  } catch (caught) {
    return isAborted(context.signal) ? failure('get_quote', 'request_aborted') : failure('get_quote', safeErrorCode(errorCode(caught), 'provider_unavailable'));
  }
}

type Candle = { time: string; close: number };

function candles(value: unknown): Candle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isObject(item)) return [];
    const time = isoTimestamp(item.time);
    const close = boundedNumber(item.close, 0, 1_000_000_000_000);
    return time === OMIT || close === OMIT ? [] : [{ time, close }];
  });
}

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function calculateIndicators(candleData: Candle[]): { close: number; sma14: number; rsi14: number; asOf: string } | undefined {
  if (candleData.length < 15) return undefined;
  const sample = candleData.slice(-15);
  const closes = sample.map((candle) => candle.close);
  const changes = closes.slice(1).map((close, index) => close - (closes[index] ?? close));
  const averageGain = changes.reduce((total, change) => total + Math.max(change, 0), 0) / changes.length;
  const averageLoss = changes.reduce((total, change) => total + Math.max(-change, 0), 0) / changes.length;
  const rsi14 = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
  const last = sample.at(-1);
  if (!last || !Number.isFinite(rsi14)) return undefined;
  return {
    close: roundMetric(last.close),
    sma14: roundMetric(closes.slice(-14).reduce((total, close) => total + close, 0) / 14),
    rsi14: roundMetric(rsi14),
    asOf: last.time
  };
}

async function executeTechnicalIndicators(call: ToolCall, context: ToolExecutionContext, dependencies: RegistryDependencies): Promise<ToolExecutionResult> {
  const { marketGateway } = dependencies;
  if (!marketGateway?.getCandles) return failure('get_technical_indicators', 'tool_unavailable');
  try {
    const argumentsValue = JSON.parse(call.arguments) as Record<string, string>;
    const response = await marketGateway.getCandles(argumentsValue.symbol ?? '', { interval: '1d', range: '1mo', signal: context.signal });
    if (isAborted(context.signal)) return failure('get_technical_indicators', 'request_aborted');
    if (!response?.ok) return failure('get_technical_indicators', safeErrorCode(isObject(response?.error) ? response.error.code : undefined, 'provider_unavailable'));
    const indicatorData = calculateIndicators(candles(response.data));
    if (!indicatorData) return failure('get_technical_indicators', 'insufficient_market_data');
    return {
      ok: true,
      name: 'get_technical_indicators',
      result: {
        data: indicatorData,
        meta: {
          ...normalizeFields(response.meta, { source: (value) => stableId(value, 128), symbol: (value) => stableId(value, 64), cached: strictBoolean }),
          interval: '1d',
          range: '1mo',
          points: candles(response.data).length
        }
      }
    };
  } catch (caught) {
    return isAborted(context.signal) ? failure('get_technical_indicators', 'request_aborted') : failure('get_technical_indicators', safeErrorCode(errorCode(caught), 'provider_unavailable'));
  }
}

function normalizeEconomicCalendar(result: Extract<EconomicCalendarResult, { ok: true }>): UnknownRecord {
  return {
    events: result.events.map((event) => normalizeFields(event, {
      time: isoTimestamp,
      country: (value) => stableId(value, 8),
      title: (value) => text(value, 200),
      impact: (value) => stableId(value, 16),
      actual: (value) => text(value, 80),
      forecast: (value) => text(value, 80),
      previous: (value) => text(value, 80)
    })),
    meta: normalizeFields(result, { source: (value) => stableId(value, 64), fetchedAt: isoTimestamp })
  };
}

async function executeEconomicCalendar(_call: ToolCall, context: ToolExecutionContext, dependencies: RegistryDependencies): Promise<ToolExecutionResult> {
  if (!dependencies.economicCalendar) return failure('get_economic_calendar', 'tool_unavailable');
  try {
    const response = await dependencies.economicCalendar({ signal: context.signal });
    if (isAborted(context.signal)) return failure('get_economic_calendar', 'request_aborted');
    if (!response.ok) return failure('get_economic_calendar', response.errorCode);
    return { ok: true, name: 'get_economic_calendar', result: normalizeEconomicCalendar(response) };
  } catch (caught) {
    return isAborted(context.signal) ? failure('get_economic_calendar', 'request_aborted') : failure('get_economic_calendar', safeErrorCode(errorCode(caught), 'calendar_unavailable'));
  }
}

type ToolImplementation = (call: ToolCall, context: ToolExecutionContext, dependencies: RegistryDependencies) => Promise<ToolExecutionResult>;

function manifest(name: ToolName, definitionValue: ToolDefinition, implementation: ToolImplementation, dependencies: RegistryDependencies): ToolManifest {
  return Object.freeze({
    name,
    version: '1.0.0',
    riskLevel: 'read_only' as const,
    timeoutMs: TOOL_TIMEOUT_MS,
    definition: definitionValue,
    execute: (call: ToolCall, context: ToolExecutionContext) => implementation(call, context, dependencies)
  });
}

function manifestsFor(dependencies: RegistryDependencies): readonly ToolManifest[] {
  return Object.freeze([
    manifest('get_weather', definition('get_weather', '查询指定城市或当前用户所在地的实时天气。', { city: { type: 'string', maxLength: 64 } }), executeWeather, dependencies),
    manifest('search_news', definition('search_news', '检索与查询主题相关的近期新闻和报道。', { query: { type: 'string', maxLength: 120 } }, ['query']), executeNews, dependencies),
    manifest('search_asset', definition('search_asset', '根据名称或代码查找可查询行情的金融资产。', { query: { type: 'string', maxLength: 64 } }, ['query']), executeAssetSearch, dependencies),
    manifest('get_quote', definition('get_quote', '查询已确认市场代码的最新报价和数据时间。', { symbol: { type: 'string', maxLength: 32 } }, ['symbol']), executeQuote, dependencies),
    manifest('get_technical_indicators', definition('get_technical_indicators', '基于固定的日线窗口计算 SMA14 和 RSI14 技术指标。', { symbol: { type: 'string', maxLength: 32 } }, ['symbol']), executeTechnicalIndicators, dependencies),
    manifest('get_economic_calendar', definition('get_economic_calendar', '查询本周已公布和即将公布的宏观经济日历。', {}), executeEconomicCalendar, dependencies)
  ]);
}

function executeWithBounds(manifest: ToolManifest, call: ToolCall, context: ToolExecutionContext, dependencies: RegistryDependencies): Promise<ToolExecutionResult> {
  if (isAborted(context.signal)) return Promise.resolve(failure(manifest.name, 'request_aborted'));
  const controller = new AbortController();
  const childContext = { ...context, signal: controller.signal };
  const scheduler: TimeoutScheduler = dependencies.timeoutScheduler ?? {
    setTimeout: (callback, timeoutMs) => globalThis.setTimeout(callback, timeoutMs),
    clearTimeout: (timeout) => globalThis.clearTimeout(timeout)
  };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ToolExecutionResult) => {
      if (settled) return;
      settled = true;
      scheduler.clearTimeout(timeout);
      context.signal?.removeEventListener('abort', onParentAbort);
      resolve(result);
    };
    const onParentAbort = () => {
      controller.abort();
      finish(failure(manifest.name, 'request_aborted'));
    };
    const timeout = scheduler.setTimeout(() => {
      controller.abort();
      finish(failure(manifest.name, context.signal?.aborted ? 'request_aborted' : 'tool_execution_timeout'));
    }, manifest.timeoutMs);
    context.signal?.addEventListener('abort', onParentAbort, { once: true });
    void manifest.execute(call, childContext).then(
      (result) => finish(context.signal?.aborted ? failure(manifest.name, 'request_aborted') : result),
      () => finish(context.signal?.aborted ? failure(manifest.name, 'request_aborted') : failure(manifest.name, 'tool_execution_failed'))
    );
  });
}

export function createToolRegistry(dependencies: RegistryDependencies = {}): ToolManifestRegistry {
  const manifests = manifestsFor(dependencies);
  return {
    manifests: () => manifests,
    definitions: () => manifests.map((manifestValue) => manifestValue.definition),
    async execute(call: ToolCall, context: ToolExecutionContext = {}): Promise<ToolExecutionResult> {
      const parsed = parseCall(call, manifests);
      if (!parsed.ok) return parsed;
      const validatedCall: ToolCall = {
        ...call,
        name: parsed.manifest.name,
        arguments: JSON.stringify(parsed.arguments)
      };
      return executeWithBounds(parsed.manifest, validatedCall, context, dependencies);
    }
  };
}
