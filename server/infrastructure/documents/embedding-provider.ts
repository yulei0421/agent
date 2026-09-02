import { AppError } from '../../domain/errors/app-error.js';
import type { EmbeddingProvider } from '../../application/chat/document-retrieval.js';

export class HttpEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async embed(text: string, signal?: AbortSignal): Promise<readonly number[]> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: text.slice(0, 8_000) }),
      signal
    });
    if (!response.ok) throw new AppError('provider_unavailable');
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) throw new AppError('provider_unavailable');
    const embedding = (payload as { data: unknown[] }).data[0];
    const values = embedding && typeof embedding === 'object' && Array.isArray((embedding as { embedding?: unknown }).embedding)
      ? (embedding as { embedding: unknown[] }).embedding
      : [];
    if (values.length < 8 || values.length > 8_192 || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new AppError('provider_unavailable');
    return values as number[];
  }
}
