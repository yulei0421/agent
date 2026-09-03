import type { ExtractedDocument, SourceDocumentMimeType, TextDocumentMimeType } from '../../shared/document.js';

const MAX_ATTACHMENT_CHARS = 3500;
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json']);

export interface TextAttachment {
  name: string;
  content: string;
}

export type ChatDocument = ExtractedDocument;
export type BinaryAttachmentMimeType = Exclude<SourceDocumentMimeType, TextDocumentMimeType>;

export interface BinaryAttachment {
  name: string;
  mimeType: BinaryAttachmentMimeType;
  data: string;
}

const BINARY_ATTACHMENT_EXTENSIONS: Readonly<Record<BinaryAttachmentMimeType, readonly string[]>> = Object.freeze({
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp']
});

const MAX_BINARY_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export interface DocumentRetrievalOptions {
  maxDocuments?: number;
  maxCharsPerDocument?: number;
  chunkChars?: number;
}

function extension(name: string): string {
  return name.toLowerCase().split('.').pop() ?? '';
}

export function normalizeTextAttachment(name: unknown, content: unknown): TextAttachment | null {
  if (typeof name !== 'string' || typeof content !== 'string') return null;
  const trimmedName = name.trim().replace(/[\u0000-\u001f\u007f]/gu, '');
  const trimmedContent = content.trim();
  const ext = extension(trimmedName);
  if (!trimmedName || !ALLOWED_ATTACHMENT_EXTENSIONS.has(ext) || !trimmedContent) return null;
  if (trimmedContent.length > MAX_ATTACHMENT_CHARS) return null;
  const extensionWithDot = trimmedName.slice(-(ext.length + 1));
  const stem = trimmedName.slice(0, -extensionWithDot.length);
  return { name: `${stem.slice(0, 96 - extensionWithDot.length)}${extensionWithDot}`, content: trimmedContent };
}

export const MAX_TEXT_ATTACHMENT_CHARS = MAX_ATTACHMENT_CHARS;

export function toChatDocument(attachment: TextAttachment): ChatDocument {
  const ext = extension(attachment.name);
  const mimeType = ext === 'md' ? 'text/markdown' : ext === 'csv' ? 'text/csv' : ext === 'json' ? 'application/json' : 'text/plain';
  return { name: attachment.name, mimeType, text: attachment.content };
}

function binaryMimeType(file: File): BinaryAttachmentMimeType | null {
  const ext = extension(file.name);
  for (const [mimeType, extensions] of Object.entries(BINARY_ATTACHMENT_EXTENSIONS) as [BinaryAttachmentMimeType, readonly string[]][]) {
    if (extensions.includes(ext)) return mimeType;
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function ingestBinaryAttachment(file: File): Promise<ChatDocument> {
  if (file.size <= 0 || file.size > MAX_BINARY_ATTACHMENT_BYTES) throw new Error('PDF 或图片大小必须在 1B 到 8MB 之间');
  const mimeType = binaryMimeType(file);
  if (!mimeType) throw new Error('仅支持 PDF、PNG、JPG、JPEG、WEBP 文件');
  const response = await fetch('/api/documents/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, mimeType, data: toBase64(new Uint8Array(await file.arrayBuffer())) })
  });
  const payload = await response.json().catch((): { errorCode?: unknown; document?: unknown } => ({})) as { errorCode?: unknown; document?: unknown };
  if (!response.ok || !payload.document || typeof payload.document !== 'object' || Array.isArray(payload.document)) {
    throw new Error(typeof payload.errorCode === 'string' ? payload.errorCode : `附件解析失败：${response.status}`);
  }
  const document = payload.document as Partial<ChatDocument>;
  if (typeof document.name !== 'string' || typeof document.mimeType !== 'string' || !['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(document.mimeType) || typeof document.text !== 'string') {
    throw new Error('附件解析结果无效');
  }
  return document as ChatDocument;
}

function searchTokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]/gu) ?? [];
}

function splitChunks(text: string, chunkChars: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += chunkChars) {
    const chunk = text.slice(start, start + chunkChars).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function scoreChunk(chunk: string, queryTokens: readonly string[]): number {
  if (queryTokens.length === 0) return 0;
  const tokens = new Set(searchTokens(chunk));
  const overlap = queryTokens.reduce((score, token) => score + (tokens.has(token) ? 1 : 0), 0);
  const phraseBonus = queryTokens.length > 1 && chunk.toLocaleLowerCase().includes(queryTokens.join('')) ? 2 : 0;
  return overlap + phraseBonus;
}

// Retrieve bounded local snippets so older attachments remain useful without uploading an index.
export function retrieveDocumentContext(
  documents: readonly ChatDocument[],
  query: string,
  options: DocumentRetrievalOptions = {}
): ChatDocument[] {
  const maxDocuments = options.maxDocuments ?? 4;
  const maxCharsPerDocument = options.maxCharsPerDocument ?? MAX_ATTACHMENT_CHARS;
  const chunkChars = Math.max(160, options.chunkChars ?? 700);
  const queryTokens = searchTokens(query);
  const grouped = new Map<string, { document: ChatDocument; chunks: { text: string; score: number; order: number }[] }>();

  for (const document of documents) {
    const key = `${document.mimeType}:${document.name}`;
    const existing = grouped.get(key) ?? { document, chunks: [] };
    const chunks = document.chunks?.length ? [...document.chunks] : splitChunks(document.text, chunkChars);
    chunks.forEach((text, order) => existing.chunks.push({ text, score: scoreChunk(text, queryTokens), order }));
    grouped.set(key, existing);
  }

  return [...grouped.values()]
    .sort((left, right) => {
      const leftScore = Math.max(...left.chunks.map((chunk) => chunk.score), 0);
      const rightScore = Math.max(...right.chunks.map((chunk) => chunk.score), 0);
      return rightScore - leftScore || left.document.name.localeCompare(right.document.name);
    })
    .slice(0, maxDocuments)
    .map(({ document, chunks }) => {
      const selected = [...chunks].sort((left, right) => right.score - left.score || left.order - right.order);
      const textParts: string[] = [];
      let total = 0;
      for (const chunk of selected) {
        const remaining = maxCharsPerDocument - total;
        if (remaining <= 0) break;
        textParts.push(chunk.text.slice(0, remaining));
        total += Math.min(chunk.text.length, remaining);
      }
      const assembled = textParts.sort((left, right) => document.text.indexOf(left) - document.text.indexOf(right)).join('\n\n');
      return { ...document, text: (assembled || document.text).slice(0, maxCharsPerDocument), chunks: undefined };
    });
}
