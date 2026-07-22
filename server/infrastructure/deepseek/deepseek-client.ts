import { createDeepSeekSseParser } from '../../sse.js';
import { AppError } from '../../domain/errors/app-error.js';
import type { ModelClient, ModelRequest } from '../../application/chat/chat.ports.js';
import type { DeepSeekSseEvent } from '../../sse.js';

type DeepSeekFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: DeepSeekFetch;
}

export class DeepSeekClient implements ModelClient {
  private readonly fetchImpl: DeepSeekFetch;

  constructor(private readonly options: DeepSeekClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<DeepSeekSseEvent> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: request.messages,
          tools: request.forceFinalAnswer ? [] : request.tools,
          tool_choice: 'auto',
          stream: true,
          thinking: { type: 'disabled' }
        }),
        signal
      });
    } catch (error) {
      if (signal.aborted) throw new AppError('request_aborted');
      throw new AppError('model_unavailable', error instanceof Error ? error.message : 'Model request failed');
    }

    if (!response.ok || !response.body) {
      throw new AppError('model_unavailable', `Model request failed with status ${response.status}`);
    }

    const pending: DeepSeekSseEvent[] = [];
    const parser = createDeepSeekSseParser((event) => pending.push(event));
    const decoder = new TextDecoder();
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) throw new AppError('request_aborted');
        parser.push(decoder.decode(chunk, { stream: true }));
        while (pending.length > 0) {
          const event = pending.shift();
          if (event) yield event;
        }
      }
      parser.flush();
      while (pending.length > 0) {
        const event = pending.shift();
        if (event) yield event;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal.aborted) throw new AppError('request_aborted');
      throw new AppError('model_unavailable', error instanceof Error ? error.message : 'Model stream failed');
    }
  }
}
