import { createHash } from 'node:crypto';
import { AppError } from '../../domain/errors/app-error.js';
import type { IngestableDocumentMimeType } from './document-ingestion.service.js';

export interface DocumentScanResult {
  readonly sha256: string;
  readonly accepted: boolean;
  readonly reason?: 'malware_signature' | 'encrypted_pdf' | 'quota_exceeded';
}

export interface DocumentSecurityOptions {
  readonly maxBytesPerSubject?: number;
  readonly maxDocumentsPerSubject?: number;
  readonly now?: () => number;
  readonly scanner?: (input: { name: string; mimeType: IngestableDocumentMimeType; data: Buffer }) => Promise<boolean> | boolean;
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * Security boundary for uploaded documents. The default scanner is intentionally
 * conservative and deterministic; deployments can inject ClamAV/ICAP while
 * retaining the same fail-closed contract.
 */
export class DocumentSecurityService {
  private readonly bytesBySubject = new Map<string, { bytes: number; resetAt: number }>();
  private readonly documentsBySubject = new Map<string, { count: number; resetAt: number }>();
  private readonly maxBytesPerSubject: number;
  private readonly maxDocumentsPerSubject: number;
  private readonly now: () => number;
  private readonly scanner: NonNullable<DocumentSecurityOptions['scanner']>;

  constructor(options: DocumentSecurityOptions = {}) {
    this.maxBytesPerSubject = options.maxBytesPerSubject ?? 32 * 1024 * 1024;
    this.maxDocumentsPerSubject = options.maxDocumentsPerSubject ?? 20;
    this.now = options.now ?? Date.now;
    this.scanner = options.scanner ?? ((input) => !input.data.toString('latin1').includes(EICAR));
    if (!Number.isSafeInteger(this.maxBytesPerSubject) || this.maxBytesPerSubject < 1) throw new Error('Document security byte quota is invalid');
    if (!Number.isSafeInteger(this.maxDocumentsPerSubject) || this.maxDocumentsPerSubject < 1) throw new Error('Document security document quota is invalid');
  }

  async inspect(input: {
    name: string;
    mimeType: IngestableDocumentMimeType;
    data: Buffer;
    subject?: string;
  }): Promise<DocumentScanResult> {
    const sha256 = createHash('sha256').update(input.data).digest('hex');
    if (input.mimeType === 'application/pdf' && /\/Encrypt\b|\/Filter\s*\/Standard\b/u.test(input.data.toString('latin1'))) {
      throw new AppError('document_rejected', 'Encrypted PDFs are not accepted');
    }
    const cleanSubject = this.subject(input.subject);
    const now = this.now();
    const byteEntry = this.bytesBySubject.get(cleanSubject);
    const docEntry = this.documentsBySubject.get(cleanSubject);
    const resetAt = now + 24 * 60 * 60 * 1000;
    const bytes = byteEntry && byteEntry.resetAt > now ? byteEntry.bytes : 0;
    const documents = docEntry && docEntry.resetAt > now ? docEntry.count : 0;
    if (bytes + input.data.byteLength > this.maxBytesPerSubject || documents + 1 > this.maxDocumentsPerSubject) {
      throw new AppError('document_rejected', 'Document upload quota exceeded');
    }
    let accepted = false;
    try {
      accepted = await this.scanner(input);
    } catch {
      throw new AppError('document_rejected', 'Document security scan unavailable');
    }
    if (!accepted) throw new AppError('document_rejected', 'Document rejected by security scanner');
    this.bytesBySubject.set(cleanSubject, { bytes: bytes + input.data.byteLength, resetAt });
    this.documentsBySubject.set(cleanSubject, { count: documents + 1, resetAt });
    return Object.freeze({ sha256, accepted: true });
  }

  private subject(value: string | undefined): string {
    if (!value || !/^[A-Za-z0-9:._-]{1,128}$/u.test(value)) return 'anonymous';
    return value;
  }
}
