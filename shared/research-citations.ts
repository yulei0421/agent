export interface ResearchCitation {
  id: string;
  label: string;
  observedAt?: string;
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

export function collectResearchCitations(events: readonly unknown[]): readonly ResearchCitation[] {
  const citations = new Map<string, ResearchCitation>();
  const add = (idValue: unknown, labelValue: unknown, observedValue: unknown, fallback: string): void => {
    const id = safeId(idValue);
    if (!id || citations.has(id)) return;
    citations.set(id, {
      id,
      label: safeLabel(labelValue, fallback),
      ...(observedAt(observedValue) ? { observedAt: observedAt(observedValue) } : {})
    });
  };

  for (const event of events) {
    if (!isRecord(event) || event.type !== 'tool_result' || event.ok !== true || typeof event.name !== 'string') continue;
    const result = event.result;
    if (event.name === 'search_news' && isRecord(result) && Array.isArray(result.sources)) {
      for (const source of result.sources) {
        if (!isRecord(source)) continue;
        add(source.citationId, source.title ?? source.publisher, source.publishedAt, event.name);
      }
    }
    if (isRecord(result)) {
      const weather = isRecord(result.weather) ? result.weather : undefined;
      if (weather) add(weather.source, weather.city, weather.observedAt, event.name);
      const meta = isRecord(result.meta) ? result.meta : undefined;
      if (meta) add(meta.source, meta.symbol, firstObservedAt(meta), event.name);
    }
    if (Array.isArray(result)) {
      for (const item of result) {
        if (!isRecord(item)) continue;
        add(item.source, item.name ?? item.symbol, item.observedAt, event.name);
      }
    }
  }

  return [...citations.values()];
}
