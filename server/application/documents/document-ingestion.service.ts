import { AppError } from '../../domain/errors/app-error.js';
import type { ExtractedDocument, SourceDocumentMimeType } from '../../../shared/document.js';
import { DocumentSecurityService } from './document-security.service.js';

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_NAME = 96;
export const MAX_EXTRACTED_TEXT = 14_000;
export const MAX_EXTRACTED_CHUNKS = 16;
export const MAX_CHUNK_CHARS = 1_200;

export type IngestableDocumentMimeType = Exclude<SourceDocumentMimeType, 'text/plain' | 'text/markdown' | 'text/csv' | 'application/json'>;

export interface ExtractedDocumentContent {
  readonly text: string;
  readonly chunks: readonly string[];
  readonly pageCount?: number;
  readonly ocrUsed: boolean;
}

export interface DocumentExtractor {
  extract(input: { mimeType: IngestableDocumentMimeType; data: Buffer; signal?: AbortSignal }): Promise<ExtractedDocumentContent>;
}

interface UploadInput {
  readonly name: string;
  readonly mimeType: IngestableDocumentMimeType;
  readonly data: Buffer;
}

const EXTENSIONS: Readonly<Record<IngestableDocumentMimeType, readonly string[]>> = Object.freeze({
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp']
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBase64(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 64 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 === 1) return null;
  const data = Buffer.from(value, 'base64');
  return data.length > 0 && data.length <= MAX_DOCUMENT_BYTES ? data : null;
}

function hasExpectedMagic(mimeType: IngestableDocumentMimeType, data: Buffer): boolean {
  if (mimeType === 'application/pdf') return data.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return data.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  return data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
}

function parseUpload(value: unknown): UploadInput | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.mimeType !== 'string') return null;
  const mimeType = value.mimeType as IngestableDocumentMimeType;
  if (!Object.hasOwn(EXTENSIONS, mimeType)) return null;
  const name = value.name.trim().replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, MAX_DOCUMENT_NAME);
  const extension = name.toLowerCase().split('.').pop() ?? '';
  const data = parseBase64(value.data);
  if (!name || !EXTENSIONS[mimeType].includes(extension) || !data || !hasExpectedMagic(mimeType, data)) return null;
  return { name, mimeType, data };
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function chunkText(value: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < value.length && chunks.length < MAX_EXTRACTED_CHUNKS; start += MAX_CHUNK_CHARS) {
    const chunk = value.slice(start, start + MAX_CHUNK_CHARS).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

export class DocumentIngestionService {
  constructor(
    private readonly extractor: DocumentExtractor,
    private readonly security: DocumentSecurityService = new DocumentSecurityService()
  ) {}

  async ingest(value: unknown, signal?: AbortSignal, subject?: string): Promise<ExtractedDocument> {
    const input = parseUpload(value);
    if (!input) throw new AppError('invalid_request');
    if (signal?.aborted) throw new AppError('request_aborted');
    await this.security.inspect({ ...input, ...(subject ? { subject } : {}) });
    let extracted: ExtractedDocumentContent;
    try {
      extracted = await this.extractor.extract({ ...input, signal });
    } catch (error) {
      if (signal?.aborted) throw new AppError('request_aborted');
      if (error instanceof AppError) throw error;
      throw new AppError('internal_error');
    }
    const text = cleanText(extracted.text).slice(0, MAX_EXTRACTED_TEXT);
    const chunks = extracted.chunks.length > 0
      ? extracted.chunks.map((chunk) => cleanText(chunk).slice(0, MAX_CHUNK_CHARS)).filter(Boolean).slice(0, MAX_EXTRACTED_CHUNKS)
      : chunkText(text);
    if (!text || chunks.length === 0) throw new AppError('invalid_request');
    return Object.freeze({
      name: input.name,
      mimeType: 'text/plain',
      text: text.slice(0, 3_500),
      sourceMimeType: input.mimeType,
      sourceKind: input.mimeType === 'application/pdf' ? 'pdf' : 'image',
      ...(extracted.pageCount ? { pageCount: extracted.pageCount } : {}),
      ocrUsed: extracted.ocrUsed,
      chunks: Object.freeze(chunks)
    });
  }
}
