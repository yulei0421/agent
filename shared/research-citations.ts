export interface ResearchCitation {
  id: string;
  label: string;
  observedAt?: string;
  freshness?: 'fresh' | 'stale' | 'unknown';
  expired?: boolean;
}

export interface ResearchCitationOptions {
  now?: Date;
  staleAfterMs?: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return undefined;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(value)) return undefined;
  return value;
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 300) return fallback;
  const normalized = value.trim();
  return /(?:^|[^\p{L}\p{N}])[A-Za-z][A-Za-z0-9+.-]*:\/{1,2}\S/iu.test(normalized)
    || /\bwww\./iu.test(normalized)
    || /\b\d{1,3}(?:\.\d{1,3}){3}\b/u.test(normalized)
    ? fallback
    : normalized;
}

function observedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function firstObservedAt(value: UnknownRecord): string | undefined {
  return observedAt(value.observedAt) ?? observedAt(value.publishedAt) ?? observedAt(value.asOf) ?? observedAt(value.fetchedAt);
}

function citationFreshness(observedValue: unknown, ageValue: unknown, options: ResearchCitationOptions): 'fresh' | 'stale' | 'unknown' {
  const threshold = options.staleAfterMs ?? 60 * 60 * 1000;
  if (typeof ageValue === 'number' && Number.isFinite(ageValue) && ageValue >= 0) return ageValue * 1000 > threshold ? 'stale' : 'fresh';
  const observed = observedAt(observedValue);
  if (!observed || !options.now) return 'unknown';
  const age = options.now.getTime() - Date.parse(observed);
  return age >= 0 && age > threshold ? 'stale' : 'fresh';
}

export function collectResearchCitations(events: readonly unknown[], options: ResearchCitationOptions = {}): readonly ResearchCitation[] {
  const citations = new Map<string, ResearchCitation>();
  const add = (idValue: unknown, labelValue: unknown, observedValue: unknown, fallback: string, ageValue?: unknown): void => {
    const id = safeId(idValue);
    if (!id || citations.has(id)) return;
    const observed = observedAt(observedValue);
    const freshness = options.now ? citationFreshness(observedValue, ageValue, options) : undefined;
    citations.set(id, {
      id,
      label: safeLabel(labelValue, fallback),
      ...(observed ? { observedAt: observed } : {}),
      ...(freshness ? { freshness, expired: freshness === 'stale' } : {})
    });
  };

  for (const event of events) {
    if (!isRecord(event) || event.type !== 'tool_result' || event.ok !== true || typeof event.name !== 'string') continue;
    const result = event.result;
    if (event.name === 'search_news' && isRecord(result) && Array.isArray(result.sources)) {
      for (const source of result.sources) {
        if (!isRecord(source)) continue;
        add(source.citationId, source.title ?? source.publisher, source.publishedAt, event.name, result.latestAgeSeconds);
      }
    }
    if (isRecord(result)) {
      const weather = isRecord(result.weather) ? result.weather : undefined;
      if (weather) add(weather.source, weather.city, weather.observedAt, event.name, weather.ageSeconds);
      const meta = isRecord(result.meta) ? result.meta : undefined;
      if (meta) add(meta.source, meta.symbol, firstObservedAt(meta), event.name, meta.ageSeconds);
    }
    if (Array.isArray(result)) {
      for (const item of result) {
        if (!isRecord(item)) continue;
        add(item.source, item.name ?? item.symbol, item.observedAt, event.name, item.ageSeconds);
      }
    }
  }

  return [...citations.values()];
}
