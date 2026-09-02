import type { DocumentSummary } from './document-input.js';

const MAX_DOCUMENTS = 4;
const MAX_CHARS_PER_DOCUMENT = 3_500;
const DEFAULT_CHUNK_CHARS = 700;

export interface EmbeddingProvider {
  embed(text: string, signal?: AbortSignal): Promise<readonly number[]>;
}

/** Deterministic local fallback; production deployments can inject a remote model provider. */
export class HashEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 96) {}
  async embed(text: string): Promise<readonly number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const token of tokens(text)) {
      let hash = 2166136261;
      for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      const index = Math.abs(hash) % this.dimensions;
      vector[index] = (vector[index] ?? 0) + 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
  }
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]/gu) ?? [];
}

function vector(value: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const token of tokens(value)) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [token, value] of left) dot += value * (right.get(token) ?? 0);
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function split(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += DEFAULT_CHUNK_CHARS) {
    const chunk = text.slice(start, start + DEFAULT_CHUNK_CHARS).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/** Request-scoped retrieval keeps only the most relevant snippets in the model context. */
export function retrieveDocumentContext(documents: readonly DocumentSummary[], query: string): DocumentSummary[] {
  const queryVector = vector(query);
  const grouped = new Map<string, { document: DocumentSummary; chunks: { text: string; score: number; order: number }[] }>();
  for (const document of documents) {
    const key = `${document.mimeType}:${document.name}`;
    const entry = grouped.get(key) ?? { document, chunks: [] };
    (document.chunks?.length ? document.chunks : split(document.text)).forEach((text, order) => {
      entry.chunks.push({ text, score: cosine(queryVector, vector(text)), order });
    });
    grouped.set(key, entry);
  }
  return [...grouped.values()]
    .sort((left, right) => {
      const leftScore = Math.max(...left.chunks.map((chunk) => chunk.score), 0);
      const rightScore = Math.max(...right.chunks.map((chunk) => chunk.score), 0);
      return rightScore - leftScore || left.document.name.localeCompare(right.document.name);
    })
    .slice(0, MAX_DOCUMENTS)
    .map(({ document, chunks }) => {
      const selected = [...chunks].sort((left, right) => right.score - left.score || left.order - right.order);
      const snippets: { text: string; order: number }[] = [];
      let total = 0;
      for (const chunk of selected) {
        const remaining = MAX_CHARS_PER_DOCUMENT - total;
        if (remaining <= 0) break;
        const text = chunk.text.slice(0, remaining);
        snippets.push({ text, order: chunk.order });
        total += text.length;
      }
      snippets.sort((left, right) => left.order - right.order);
      return { ...document, text: (snippets.map((item) => item.text).join('\n\n') || document.text).slice(0, MAX_CHARS_PER_DOCUMENT), chunks: undefined };
    });
}

export async function retrieveDocumentContextWithEmbeddings(
  documents: readonly DocumentSummary[],
  query: string,
  provider: EmbeddingProvider,
  signal?: AbortSignal
): Promise<DocumentSummary[]> {
  if (signal?.aborted) return [];
  const queryVector = await provider.embed(query, signal);
  const grouped = new Map<string, { document: DocumentSummary; chunks: { text: string; score: number; order: number }[] }>();
  for (const document of documents) {
    const key = `${document.mimeType}:${document.name}`;
    const entry = grouped.get(key) ?? { document, chunks: [] };
    const sourceChunks = document.chunks?.length ? document.chunks : split(document.text);
    for (let order = 0; order < sourceChunks.length; order += 1) {
      const text = sourceChunks[order]!;
      const embedding = await provider.embed(text, signal);
      entry.chunks.push({ text, score: numericCosine(queryVector, embedding), order });
    }
    grouped.set(key, entry);
  }
  return rankGrouped(grouped);
}

function numericCosine(left: readonly number[], right: readonly number[]): number {
  const size = Math.min(left.length, right.length);
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const a = left[index] ?? 0; const b = right[index] ?? 0;
    dot += a * b; leftNorm += a * a; rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function rankGrouped(grouped: Map<string, { document: DocumentSummary; chunks: { text: string; score: number; order: number }[] }>): DocumentSummary[] {
  return [...grouped.values()]
    .sort((left, right) => Math.max(...right.chunks.map((chunk) => chunk.score), 0) - Math.max(...left.chunks.map((chunk) => chunk.score), 0) || left.document.name.localeCompare(right.document.name))
    .slice(0, MAX_DOCUMENTS)
    .map(({ document, chunks }) => {
      const selected = [...chunks].sort((left, right) => right.score - left.score || left.order - right.order);
      let total = 0;
      const snippets = selected.flatMap((chunk) => {
        const remaining = MAX_CHARS_PER_DOCUMENT - total;
        if (remaining <= 0) return [];
        const text = chunk.text.slice(0, remaining);
        total += text.length;
        return [{ text, order: chunk.order }];
      }).sort((left, right) => left.order - right.order);
      return { ...document, text: (snippets.map((item) => item.text).join('\n\n') || document.text).slice(0, MAX_CHARS_PER_DOCUMENT), chunks: undefined };
    });
}
