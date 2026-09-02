import type { ModelClient, ModelRequest, ModelTaskType } from '../../application/chat/chat.ports.js';
import type { DeepSeekSseEvent } from '../../sse.js';
import { ModelRegistry } from './model-registry.js';

export type ModelRouteTable = Partial<Record<ModelTaskType, ModelClient>>;

const TASK_TYPES = new Set<ModelTaskType>(['fast', 'reasoning', 'structured']);

function validTaskType(value: unknown): value is ModelTaskType {
  return typeof value === 'string' && TASK_TYPES.has(value as ModelTaskType);
}

/** Selects only server-owned model clients; request data never changes endpoints or credentials. */
export class ModelRouter implements ModelClient {
  private readonly routes: Readonly<Partial<Record<ModelTaskType, ModelClient>>>;
  readonly usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };

  constructor(private readonly fallback: ModelClient, routes: ModelRouteTable = {}, private readonly registry?: ModelRegistry) {
    this.routes = Object.freeze({ ...routes });
  }

  clientFor(taskType: unknown): ModelClient {
    return (validTaskType(taskType) ? this.routes[taskType] : undefined) ?? this.fallback;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<DeepSeekSseEvent> {
    const estimatedInputTokens = request.messages.reduce<number>((sum, message) => sum + Math.ceil(String(JSON.stringify(message)).length / 4), 0);
    const registered = this.registry?.select({
      taskType: request.taskType,
      structured: request.responseFormat?.type === 'json_object',
      estimatedTokens: estimatedInputTokens
    });
    const client = (registered?.client as ModelClient | undefined) ?? this.clientFor(request.taskType);
    // Strip routing metadata before handing the request to an upstream client.
    const { taskType: _taskType, ...upstreamRequest } = request;
    let output = 0;
    try {
      for await (const event of client.stream(upstreamRequest, signal)) {
        if (event.type === 'delta' || event.type === 'reasoning') output += Math.ceil(event.content.length / 4);
        yield event;
      }
      if (registered) this.registry?.markHealth(registered.id, true);
    } catch (error) {
      if (registered) this.registry?.markHealth(registered.id, false);
      throw error;
    }
    const inputTokens = estimatedInputTokens;
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += output;
    if (registered) this.usage.estimatedCostUsd += (inputTokens * registered.inputPricePerMillion + output * registered.outputPricePerMillion) / 1_000_000;
  }
}
