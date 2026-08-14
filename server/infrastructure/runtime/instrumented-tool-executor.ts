import type { ToolCall, ToolExecutionContext, ToolExecutionResult, ToolExecutor } from '../../domain/tools/tool.types.js';
import { RuntimeTelemetry } from './runtime-telemetry.js';

// The wrapper observes only fixed tool names and normalized results from the registry.
export class InstrumentedToolExecutor implements ToolExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly telemetry: RuntimeTelemetry,
    private readonly now: () => number = Date.now
  ) {}

  definitions() {
    return this.inner.definitions();
  }

  async execute(call: ToolCall, context?: ToolExecutionContext): Promise<ToolExecutionResult> {
    const startedAt = this.now();
    try {
      const result = await this.inner.execute(call, context);
      this.telemetry.recordTool(call.name, result.ok, this.now() - startedAt, result.ok ? result.result : undefined);
      return result;
    } catch (error) {
      this.telemetry.recordTool(call.name, false, this.now() - startedAt);
      throw error;
    }
  }
}
