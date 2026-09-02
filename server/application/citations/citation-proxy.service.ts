import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../domain/errors/app-error.js';

export interface CitationSnapshot {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly observedAt: string;
  readonly capturedAt: string;
  readonly contentHash: string;
  readonly provenance: readonly { tool: string; requestHash: string }[];
  readonly freshness: 'fresh' | 'stale' | 'unknown';
}

export interface CitationRefreshResult {
  readonly label: string;
  readonly source: string;
  readonly observedAt?: string;
  readonly payload: unknown;
}

export type CitationRefresher = (source: string, signal: AbortSignal) => Promise<CitationRefreshResult | undefined>;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export class CitationProxyService {
  private readonly entries = new Map<string, CitationSnapshot>();
  private readonly staleAfterMs: number;
  constructor(private readonly refresh?: CitationRefresher, options: { staleAfterMs?: number } = {}) {
    this.staleAfterMs = options.staleAfterMs ?? 60 * 60 * 1000;
  }

  record(input: { id?: string; tool: string; source: string; label: string; payload: unknown; observedAt?: string; request?: unknown; now?: Date }): CitationSnapshot {
    if (!/^[A-Za-z0-9._:/-]{1,256}$/u.test(input.source) || !input.tool || !input.label) throw new AppError('invalid_request');
    const capturedAt = (input.now ?? new Date()).toISOString();
    const observedAt = input.observedAt && Number.isFinite(Date.parse(input.observedAt)) ? new Date(input.observedAt).toISOString() : capturedAt;
    const id = input.id && /^[A-Za-z0-9._:/-]{1,128}$/u.test(input.id) ? input.id : randomBytes(12).toString('base64url');
    const snapshot: CitationSnapshot = Object.freeze({
      id,
      label: input.label.slice(0, 300),
      source: input.source,
      observedAt,
      capturedAt,
      contentHash: createHash('sha256').update(stableJson(input.payload)).digest('hex'),
      provenance: Object.freeze([{ tool: input.tool.slice(0, 64), requestHash: createHash('sha256').update(stableJson(input.request ?? null)).digest('hex') }]),
      freshness: 'fresh'
    });
    this.entries.set(id, snapshot);
    return snapshot;
  }

  get(id: string, now = new Date()): CitationSnapshot {
    const value = this.entries.get(id);
    if (!value) throw new AppError('citation_not_found');
    const age = now.getTime() - Date.parse(value.observedAt);
    return Object.freeze({ ...value, freshness: age > this.staleAfterMs ? 'stale' : 'fresh' });
  }

  async revalidate(id: string, signal = new AbortController().signal, now = new Date()): Promise<CitationSnapshot> {
    const current = this.get(id, now);
    if (!this.refresh) throw new AppError('citation_expired');
    if (signal.aborted) throw new AppError('request_aborted');
    const refreshed = await this.refresh(current.source, signal);
    if (!refreshed) throw new AppError('citation_expired');
    return this.record({ tool: 'citation_revalidate', source: refreshed.source, label: refreshed.label, payload: refreshed.payload, observedAt: refreshed.observedAt, now });
  }
}
