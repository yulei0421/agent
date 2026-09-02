import type { ToolCall, ToolExecutionContext, ToolExecutionResult, ToolExecutor } from '../../domain/tools/tool.types.js';
import { RuntimeTelemetry } from './runtime-telemetry.js';
import { CitationProxyService } from '../../application/citations/citation-proxy.service.js';

// The wrapper observes only fixed tool names and normalized results from the registry.
export class InstrumentedToolExecutor implements ToolExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly telemetry: RuntimeTelemetry,
    private readonly now: () => number = Date.now,
    private readonly citations?: CitationProxyService
  ) {}

  definitions() {
    return this.inner.definitions();
  }

  async execute(call: ToolCall, context?: ToolExecutionContext): Promise<ToolExecutionResult> {
    const startedAt = this.now();
    try {
      const result = await this.inner.execute(call, context);
      this.telemetry.recordTool(call.name, result.ok, this.now() - startedAt, result.ok ? result.result : undefined);
      if (result.ok && this.citations) this.captureCitations(call, result.result, context);
      return result;
    } catch (error) {
      this.telemetry.recordTool(call.name, false, this.now() - startedAt);
      throw error;
    }
  }

  private captureCitations(call: ToolCall, result: unknown, context?: ToolExecutionContext): void {
    const values = Array.isArray(result) ? result : [result];
    for (const value of values) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      if (Array.isArray(item.sources)) {
        for (const source of item.sources) {
          if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
          const sourceRecord = source as Record<string, unknown>;
          if (typeof sourceRecord.citationId !== 'string') continue;
          this.citations!.record({
            id: sourceRecord.citationId,
            tool: call.name,
            source: sourceRecord.citationId,
            label: typeof sourceRecord.title === 'string' ? sourceRecord.title : call.name,
            payload: source,
            observedAt: typeof sourceRecord.publishedAt === 'string' ? sourceRecord.publishedAt : undefined,
            request: call.arguments,
            ...(context?.now ? { now: context.now() } : {})
          });
        }
      }
      const meta = item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) ? item.meta as Record<string, unknown> : item;
      const source = typeof meta.source === 'string' ? meta.source : undefined;
      if (!source) continue;
      const label = typeof item.name === 'string' ? item.name : typeof meta.symbol === 'string' ? meta.symbol : call.name;
      const observedAt = typeof meta.observedAt === 'string' ? meta.observedAt : typeof meta.asOf === 'string' ? meta.asOf : undefined;
      this.citations!.record({ tool: call.name, source, label, payload: value, observedAt, request: call.arguments, ...(context?.now ? { now: context.now() } : {}) });
    }
  }
}
