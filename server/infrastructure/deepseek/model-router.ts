import type { ModelClient, ModelRequest, ModelTaskType } from '../../application/chat/chat.ports.js';
import type { DeepSeekSseEvent } from '../../sse.js';

export type ModelRouteTable = Partial<Record<ModelTaskType, ModelClient>>;

const TASK_TYPES = new Set<ModelTaskType>(['fast', 'reasoning', 'structured']);

function validTaskType(value: unknown): value is ModelTaskType {
  return typeof value === 'string' && TASK_TYPES.has(value as ModelTaskType);
}

/** Selects only server-owned model clients; request data never changes endpoints or credentials. */
export class ModelRouter implements ModelClient {
  private readonly routes: Readonly<Partial<Record<ModelTaskType, ModelClient>>>;

  constructor(private readonly fallback: ModelClient, routes: ModelRouteTable = {}) {
    this.routes = Object.freeze({ ...routes });
  }

  clientFor(taskType: unknown): ModelClient {
    return (validTaskType(taskType) ? this.routes[taskType] : undefined) ?? this.fallback;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<DeepSeekSseEvent> {
    const client = this.clientFor(request.taskType);
    // Strip routing metadata before handing the request to an upstream client.
    const { taskType: _taskType, ...upstreamRequest } = request;
    yield* client.stream(upstreamRequest, signal);
  }
}
