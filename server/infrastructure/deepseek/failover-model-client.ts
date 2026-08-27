import type { ModelClient, ModelRequest } from '../../application/chat/chat.ports.js';
import { AppError } from '../../domain/errors/app-error.js';
import type { DeepSeekSseEvent } from '../../sse.js';

export type ModelFailoverObserver = () => void;

function isRetryablePrimaryFailure(error: unknown): boolean {
  return error instanceof AppError && error.code === 'model_unavailable';
}

export class FailoverModelClient implements ModelClient {
  constructor(
    private readonly primary: ModelClient,
    private readonly fallback: ModelClient,
    private readonly onFailover?: ModelFailoverObserver
  ) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<DeepSeekSseEvent> {
    if (signal.aborted) throw new AppError('request_aborted');

    let hasYielded = false;
    try {
      for await (const event of this.primary.stream(request, signal)) {
        if (signal.aborted) throw new AppError('request_aborted');
        hasYielded = true;
        yield event;
      }
      return;
    } catch (error) {
      if (signal.aborted) throw new AppError('request_aborted');
      if (hasYielded || !isRetryablePrimaryFailure(error)) throw error;
    }

    this.onFailover?.();
    for await (const event of this.fallback.stream(request, signal)) {
      if (signal.aborted) throw new AppError('request_aborted');
      yield event;
    }
  }
}
