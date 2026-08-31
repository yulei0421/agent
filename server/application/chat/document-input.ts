import { isIP } from 'node:net';
import type { ExtractedDocument, TextDocumentMimeType } from '../../../shared/document.js';

export const MAX_DOCUMENT_TEXT = 3_500;
export const MAX_DOCUMENTS = 4;
export const MAX_DOCUMENT_NAME = 96;

export type DocumentMimeType = TextDocumentMimeType;
export type DocumentSummary = ExtractedDocument;

const MIME_EXTENSIONS: Readonly<Record<DocumentMimeType, readonly string[]>> = Object.freeze({
  'text/plain': ['txt'],
  'text/markdown': ['md', 'markdown'],
  'text/csv': ['csv'],
  'application/json': ['json']
});
const SOURCE_MIME_EXTENSIONS: Readonly<Record<Exclude<ExtractedDocument['sourceMimeType'], undefined>, readonly string[]>> = Object.freeze({
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp']
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsUnsafeNetworkLiteral(value: string): boolean {
  if (/(?:^|[^\p{L}\p{N}])[A-Za-z][A-Za-z0-9+.-]*:\/{1,2}\S/iu.test(value) || /\bwww\./iu.test(value)) return true;
  const ipv4 = value.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/gu) ?? [];
  if (ipv4.some((candidate) => isIP(candidate) === 4)) return true;
  return value.split(/\s+/u).some((token) => token.includes(':') && isIP(token.replace(/[()[\]{}<>,.;]+$/gu, '')) === 6);
}

function parseOne(value: unknown): DocumentSummary | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.mimeType !== 'string' || typeof value.text !== 'string') return null;
  const name = value.name.trim().replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, MAX_DOCUMENT_NAME);
  const mimeType = value.mimeType as DocumentMimeType;
  const text = value.text.trim();
  if (!name || !Object.hasOwn(MIME_EXTENSIONS, mimeType) || !text || text.length > MAX_DOCUMENT_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return null;
  const extension = name.toLowerCase().split('.').pop() ?? '';
  const sourceMimeType = value.sourceMimeType === undefined ? undefined : value.sourceMimeType as DocumentSummary['sourceMimeType'];
  if (sourceMimeType === undefined && !MIME_EXTENSIONS[mimeType].includes(extension)) return null;
  if (sourceMimeType !== undefined && (!Object.hasOwn(SOURCE_MIME_EXTENSIONS, sourceMimeType) || mimeType !== 'text/plain' || !SOURCE_MIME_EXTENSIONS[sourceMimeType].includes(extension))) return null;
  if (containsUnsafeNetworkLiteral(text)) return null;
  const sourceKind = value.sourceKind === undefined ? undefined : value.sourceKind;
  if (sourceKind !== undefined && sourceKind !== 'pdf' && sourceKind !== 'image') return null;
  if (sourceKind !== undefined && sourceMimeType === undefined) return null;
  const pageCount = value.pageCount === undefined ? undefined : value.pageCount;
  if (pageCount !== undefined && typeof pageCount !== 'number') return null;
  if (pageCount !== undefined && (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 20)) return null;
  const ocrUsed = value.ocrUsed === undefined ? undefined : value.ocrUsed;
  if (ocrUsed !== undefined && typeof ocrUsed !== 'boolean') return null;
  const chunks = value.chunks === undefined ? undefined : value.chunks;
  if (chunks !== undefined && (!Array.isArray(chunks) || chunks.length > 16 || chunks.some((chunk) => typeof chunk !== 'string' || chunk.trim().length === 0 || chunk.length > 1_200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(chunk) || containsUnsafeNetworkLiteral(chunk)))) return null;
  return Object.freeze({ name, mimeType, text, ...(sourceMimeType ? { sourceMimeType } : {}), ...(sourceKind ? { sourceKind } : {}), ...(pageCount !== undefined ? { pageCount } : {}), ...(ocrUsed !== undefined ? { ocrUsed } : {}), ...(chunks ? { chunks: Object.freeze([...chunks]) } : {}) });
}

export function parseDocumentSummaries(value: unknown): readonly DocumentSummary[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DOCUMENTS) return null;
  const documents = value.map(parseOne);
  return documents.every((document): document is DocumentSummary => document !== null)
    ? Object.freeze(documents)
    : null;
}
