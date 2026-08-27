export type ModelOutcome = 'success' | 'timeout' | 'failure' | 'retry' | 'circuit_open';
export type CircuitStatus = 'closed' | 'open' | 'half_open';

const MODEL_OUTCOMES: readonly ModelOutcome[] = ['success', 'timeout', 'failure', 'retry', 'circuit_open'];
const CIRCUIT_STATES: readonly CircuitStatus[] = ['closed', 'open', 'half_open'];
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx', 'other'] as const;
const REGISTERED_TOOLS = ['get_weather', 'search_news', 'search_asset', 'get_quote', 'get_technical_indicators', 'get_economic_calendar'] as const;
const TOOL_OUTCOMES = ['success', 'failure'] as const;
const FRESHNESS_STATES = ['fresh', 'delayed', 'stale', 'unknown'] as const;
const EXTERNAL_SOURCES = ['open_meteo', 'google_news', 'eastmoney', 'tencent', 'yahoo_finance', 'binance', 'forexfactory', 'unknown'] as const;
const SOURCE_STATUSES = ['success', 'failure', 'unknown'] as const;
const TOOL_DURATION_BUCKETS = [10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const;

type StatusClass = typeof STATUS_CLASSES[number];
type RegisteredTool = typeof REGISTERED_TOOLS[number];
type ToolOutcome = typeof TOOL_OUTCOMES[number];
type FreshnessState = typeof FRESHNESS_STATES[number];
type ExternalSource = typeof EXTERNAL_SOURCES[number];
type SourceStatus = typeof SOURCE_STATUSES[number];
type ToolObservation = { source?: unknown; ageSeconds?: unknown };

function newCounters<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function safeDuration(durationMs: number | undefined): number {
  return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
}

function statusClass(status: number): StatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

function registeredTool(value: string): RegisteredTool | undefined {
  return (REGISTERED_TOOLS as readonly string[]).includes(value) ? value as RegisteredTool : undefined;
}

function sourceFor(value: unknown): ExternalSource {
  if (value === 'open-meteo') return 'open_meteo';
  if (value === 'google-news') return 'google_news';
  if (value === 'eastmoney' || value === 'tencent' || value === 'binance' || value === 'forexfactory') return value;
  if (value === 'yahoo-finance') return 'yahoo_finance';
  return 'unknown';
}

function freshnessFor(value: unknown): FreshnessState {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'unknown';
  if (value <= 60) return 'fresh';
  if (value <= 300) return 'delayed';
  return 'stale';
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function observationFor(tool: RegisteredTool, result: unknown): ToolObservation | undefined {
  const payload = object(result);
  if (!payload) return undefined;
  if (tool === 'get_weather') {
    const weather = object(payload.weather);
    return weather ? { source: weather.source, ageSeconds: weather.ageSeconds } : undefined;
  }
  if (tool === 'search_news') return { source: 'google-news', ageSeconds: payload.latestAgeSeconds };
  if (tool === 'get_quote' || tool === 'get_technical_indicators') {
    const meta = object(payload.meta);
    return meta ? { source: meta.source, ageSeconds: meta.ageSeconds } : undefined;
  }
  if (tool === 'get_economic_calendar') {
    const meta = object(payload.meta);
    return meta ? { source: meta.source } : undefined;
  }
  return undefined;
}

// Holds aggregate process state only; untrusted values are intentionally discarded.
export class RuntimeTelemetry {
  private readonly modelCounts = newCounters(MODEL_OUTCOMES);
  private readonly modelDurationMs = newCounters(MODEL_OUTCOMES);
  private readonly toolCounts = newCounters(TOOL_OUTCOMES);
  private readonly toolDurationMs = newCounters(TOOL_OUTCOMES);
  private readonly toolCountsByName = Object.fromEntries(REGISTERED_TOOLS.map((tool) => [tool, newCounters(TOOL_OUTCOMES)])) as Record<RegisteredTool, Record<ToolOutcome, number>>;
  private readonly toolDurationBuckets = Object.fromEntries(REGISTERED_TOOLS.map((tool) => [tool, newCounters(TOOL_DURATION_BUCKETS.map(String))])) as Record<RegisteredTool, Record<string, number>>;
  private readonly toolDurationSums = newCounters(REGISTERED_TOOLS);
  private readonly toolDurationCounts = newCounters(REGISTERED_TOOLS);
  private readonly freshnessCounts = Object.fromEntries(REGISTERED_TOOLS.map((tool) => [tool, newCounters(FRESHNESS_STATES)])) as Record<RegisteredTool, Record<FreshnessState, number>>;
  private readonly sourceStatuses = Object.fromEntries(EXTERNAL_SOURCES.map((source) => [source, 'unknown'])) as Record<ExternalSource, SourceStatus>;
  private readonly httpCounts = newCounters(STATUS_CLASSES);
  private readonly httpDurationMs = newCounters(STATUS_CLASSES);
  private sseDisconnects = 0;
  private modelFailovers = 0;
  private configured = false;
  private circuit: CircuitStatus = 'closed';

  recordModel(outcome: ModelOutcome, durationMs?: number): void {
    this.modelCounts[outcome] += 1;
    this.modelDurationMs[outcome] += safeDuration(durationMs);
  }

  recordTool(name: string, ok: boolean, durationMs: number, result?: unknown): void {
    const outcome = ok ? 'success' : 'failure';
    this.toolCounts[outcome] += 1;
    const duration = safeDuration(durationMs);
    this.toolDurationMs[outcome] += duration;
    const tool = registeredTool(name);
    if (!tool) return;

    this.toolCountsByName[tool][outcome] += 1;
    this.toolDurationSums[tool] += duration;
    this.toolDurationCounts[tool] += 1;
    for (const bucket of TOOL_DURATION_BUCKETS) {
      const bucketKey = String(bucket);
      const buckets = this.toolDurationBuckets[tool];
      if (duration <= bucket && buckets) buckets[bucketKey] = (buckets[bucketKey] ?? 0) + 1;
    }

    const observation = observationFor(tool, result);
    this.freshnessCounts[tool][freshnessFor(observation?.ageSeconds)] += 1;
    if (!observation) return;
    const source = sourceFor(observation.source);
    this.sourceStatuses[source] = ok ? 'success' : 'failure';
  }

  recordSseDisconnect(): void {
    this.sseDisconnects += 1;
  }

  recordModelFailover(): void {
    this.modelFailovers += 1;
  }

  recordHttp(_route: string, status: number, durationMs: number): void {
    const outcome = statusClass(status);
    this.httpCounts[outcome] += 1;
    this.httpDurationMs[outcome] += safeDuration(durationMs);
  }

  setModelConfigured(configured: boolean): void {
    this.configured = configured;
  }

  setModelCircuit(circuit: CircuitStatus): void {
    this.circuit = circuit;
  }

  modelStatus(): { configured: boolean; circuit: CircuitStatus } {
    return { configured: this.configured, circuit: this.circuit };
  }

  metrics(): string {
    const lines = [
      '# TYPE agent_model_requests_total counter',
      ...MODEL_OUTCOMES.map((outcome) => `agent_model_requests_total{outcome="${outcome}"} ${this.modelCounts[outcome]}`),
      '# TYPE agent_model_duration_milliseconds_total counter',
      ...MODEL_OUTCOMES.map((outcome) => `agent_model_duration_milliseconds_total{outcome="${outcome}"} ${this.modelDurationMs[outcome]}`),
      '# TYPE agent_tool_calls_total counter',
      ...(['success', 'failure'] as const).map((outcome) => `agent_tool_calls_total{outcome="${outcome}"} ${this.toolCounts[outcome]}`),
      '# TYPE agent_tool_duration_milliseconds_total counter',
      ...TOOL_OUTCOMES.map((outcome) => `agent_tool_duration_milliseconds_total{outcome="${outcome}"} ${this.toolDurationMs[outcome]}`),
      '# TYPE agent_tool_calls_by_name_total counter',
      ...REGISTERED_TOOLS.flatMap((tool) => TOOL_OUTCOMES.map((outcome) => `agent_tool_calls_by_name_total{tool="${tool}",outcome="${outcome}"} ${this.toolCountsByName[tool][outcome]}`)),
      '# TYPE agent_tool_duration_milliseconds histogram',
      ...REGISTERED_TOOLS.flatMap((tool) => [
        ...TOOL_DURATION_BUCKETS.map((bucket) => `agent_tool_duration_milliseconds_bucket{tool="${tool}",le="${bucket}"} ${this.toolDurationBuckets[tool][String(bucket)]}`),
        `agent_tool_duration_milliseconds_bucket{tool="${tool}",le="+Inf"} ${this.toolDurationCounts[tool]}`,
        `agent_tool_duration_milliseconds_sum{tool="${tool}"} ${this.toolDurationSums[tool]}`,
        `agent_tool_duration_milliseconds_count{tool="${tool}"} ${this.toolDurationCounts[tool]}`
      ]),
      '# TYPE agent_tool_freshness_total counter',
      ...REGISTERED_TOOLS.flatMap((tool) => FRESHNESS_STATES.map((status) => `agent_tool_freshness_total{tool="${tool}",status="${status}"} ${this.freshnessCounts[tool][status]}`)),
      '# TYPE agent_external_source_recent_status gauge',
      ...EXTERNAL_SOURCES.flatMap((source) => SOURCE_STATUSES.map((status) => `agent_external_source_recent_status{source="${source}",status="${status}"} ${this.sourceStatuses[source] === status ? 1 : 0}`)),
      '# TYPE agent_sse_disconnects_total counter',
      `agent_sse_disconnects_total ${this.sseDisconnects}`,
      '# TYPE agent_model_failover_total counter',
      `agent_model_failover_total ${this.modelFailovers}`,
      '# TYPE agent_http_requests_total counter',
      ...STATUS_CLASSES.map((outcome) => `agent_http_requests_total{status_class="${outcome}"} ${this.httpCounts[outcome]}`),
      '# TYPE agent_http_duration_milliseconds_total counter',
      ...STATUS_CLASSES.map((outcome) => `agent_http_duration_milliseconds_total{status_class="${outcome}"} ${this.httpDurationMs[outcome]}`),
      '# TYPE agent_model_configured gauge',
      `agent_model_configured ${this.configured ? 1 : 0}`,
      '# TYPE agent_model_circuit_state gauge',
      ...CIRCUIT_STATES.map((state) => `agent_model_circuit_state{state="${state}"} ${this.circuit === state ? 1 : 0}`)
    ];
    return `${lines.join('\n')}\n`;
  }
}
