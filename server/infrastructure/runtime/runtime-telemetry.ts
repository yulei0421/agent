export type ModelOutcome = 'success' | 'timeout' | 'failure' | 'retry' | 'circuit_open';
export type CircuitStatus = 'closed' | 'open' | 'half_open';

const MODEL_OUTCOMES: readonly ModelOutcome[] = ['success', 'timeout', 'failure', 'retry', 'circuit_open'];
const CIRCUIT_STATES: readonly CircuitStatus[] = ['closed', 'open', 'half_open'];
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx', 'other'] as const;

type StatusClass = typeof STATUS_CLASSES[number];

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

// Holds aggregate process state only; untrusted values are intentionally discarded.
export class RuntimeTelemetry {
  private readonly modelCounts = newCounters(MODEL_OUTCOMES);
  private readonly modelDurationMs = newCounters(MODEL_OUTCOMES);
  private readonly toolCounts = newCounters(['success', 'failure'] as const);
  private readonly toolDurationMs = newCounters(['success', 'failure'] as const);
  private readonly httpCounts = newCounters(STATUS_CLASSES);
  private readonly httpDurationMs = newCounters(STATUS_CLASSES);
  private sseDisconnects = 0;
  private configured = false;
  private circuit: CircuitStatus = 'closed';

  recordModel(outcome: ModelOutcome, durationMs?: number): void {
    this.modelCounts[outcome] += 1;
    this.modelDurationMs[outcome] += safeDuration(durationMs);
  }

  recordTool(_name: string, ok: boolean, durationMs: number): void {
    const outcome = ok ? 'success' : 'failure';
    this.toolCounts[outcome] += 1;
    this.toolDurationMs[outcome] += safeDuration(durationMs);
  }

  recordSseDisconnect(): void {
    this.sseDisconnects += 1;
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
      ...(['success', 'failure'] as const).map((outcome) => `agent_tool_duration_milliseconds_total{outcome="${outcome}"} ${this.toolDurationMs[outcome]}`),
      '# TYPE agent_sse_disconnects_total counter',
      `agent_sse_disconnects_total ${this.sseDisconnects}`,
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
