import { AppError } from '../../domain/errors/app-error.js';
import type { ModelClient, ModelRequest } from '../../application/chat/chat.ports.js';
import type { DeepSeekSseEvent } from '../../sse.js';

// Keeps the application bootable for health checks when credentials are absent.
export class UnavailableModelClient implements ModelClient {
  async *stream(_request: ModelRequest, _signal: AbortSignal): AsyncIterable<DeepSeekSseEvent> {
    throw new AppError('model_unavailable', 'DEEPSEEK_API_KEY is not configured');
  }
}
