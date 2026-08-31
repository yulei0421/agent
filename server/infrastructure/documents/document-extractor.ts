import { createRequire } from 'node:module';
import { createWorker } from 'tesseract.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from '../../domain/errors/app-error.js';
import type { DocumentExtractor, ExtractedDocumentContent, IngestableDocumentMimeType } from '../../application/documents/document-ingestion.service.js';

const require = createRequire(import.meta.url);
const MAX_PDF_PAGES = 20;
const MAX_OCR_PAGES = 8;
const MAX_RENDER_DIMENSION = 4_000;
const MAX_RENDER_PIXELS = 16_000_000;

export interface DocumentExtractorOptions {
  ocrLanguage?: string;
  ocrLangPath?: string;
  ocrWorkerPath?: string;
  ocrCorePath?: string;
  workerFactory?: (language: string, options: Parameters<typeof createWorker>[2]) => ReturnType<typeof createWorker>;
}

interface CanvasModule {
  createCanvas(width: number, height: number): {
    getContext(type: '2d'): unknown;
    toBuffer(format: 'image/png'): Buffer;
  };
}

function canvasModule(): CanvasModule {
  try {
    return require('@napi-rs/canvas') as CanvasModule;
  } catch {
    throw new AppError('document_ocr_unavailable');
  }
}

function compact(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function imageMime(mimeType: IngestableDocumentMimeType): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp';
}

export class PdfOcrDocumentExtractor implements DocumentExtractor {
  private readonly options: Required<Pick<DocumentExtractorOptions, 'ocrLanguage'>> & Omit<DocumentExtractorOptions, 'ocrLanguage'>;

  constructor(options: DocumentExtractorOptions = {}) {
    this.options = { ocrLanguage: options.ocrLanguage ?? 'chi_sim+eng', ...options };
  }

  async extract(input: { mimeType: IngestableDocumentMimeType; data: Buffer; signal?: AbortSignal }): Promise<ExtractedDocumentContent> {
    if (input.signal?.aborted) throw new AppError('request_aborted');
    if (imageMime(input.mimeType)) {
      const text = await this.recognize(input.data, input.signal);
      return { text, chunks: [], ocrUsed: true };
    }
    return this.extractPdf(input.data, input.signal);
  }

  private async extractPdf(data: Buffer, signal?: AbortSignal): Promise<ExtractedDocumentContent> {
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    let document: Awaited<ReturnType<typeof getDocument>['promise']> | undefined;
    try {
      loadingTask = getDocument({ data: new Uint8Array(data), disableAutoFetch: true, disableStream: true });
      document = await loadingTask.promise;
      const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (signal?.aborted) throw new AppError('request_aborted');
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = compact(content.items.map((item: unknown) => {
          if (!item || typeof item !== 'object' || !('str' in item)) return '';
          const str = (item as { str?: unknown }).str;
          return typeof str === 'string' ? str : '';
        }).join(' '));
        if (text) pages.push(`第${pageNumber}页：${text}`);
      }
      const nativeText = pages.join('\n');
      if (nativeText) return { text: nativeText, chunks: pages, pageCount, ocrUsed: false };

      const ocrPages = Math.min(pageCount, MAX_OCR_PAGES);
      const ocrResults: string[] = [];
      for (let pageNumber = 1; pageNumber <= ocrPages; pageNumber += 1) {
        if (signal?.aborted) throw new AppError('request_aborted');
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.5 });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > MAX_RENDER_DIMENSION || height > MAX_RENDER_DIMENSION || width * height > MAX_RENDER_PIXELS) {
          throw new AppError('invalid_request');
        }
        const canvas = canvasModule().createCanvas(width, height);
        const canvasContext = canvas.getContext('2d');
        await page.render({ canvasContext, viewport } as never).promise;
        const text = compact(await this.recognize(canvas.toBuffer('image/png'), signal));
        if (text) ocrResults.push(`第${pageNumber}页：${text}`);
      }
      if (!ocrResults.length) throw new AppError('document_ocr_unavailable');
      return { text: ocrResults.join('\n'), chunks: ocrResults, pageCount, ocrUsed: true };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('invalid_request');
    } finally {
      await document?.destroy().catch(() => undefined);
      await loadingTask?.destroy().catch(() => undefined);
    }
  }

  private async recognize(data: Buffer, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new AppError('request_aborted');
    const workerOptions: Parameters<typeof createWorker>[2] = {
      ...(this.options.ocrLangPath ? { langPath: this.options.ocrLangPath } : {}),
      ...(this.options.ocrWorkerPath ? { workerPath: this.options.ocrWorkerPath } : {}),
      ...(this.options.ocrCorePath ? { corePath: this.options.ocrCorePath } : {}),
      cacheMethod: 'none'
    };
    const worker = await (this.options.workerFactory
      ? this.options.workerFactory(this.options.ocrLanguage, workerOptions)
      : createWorker(this.options.ocrLanguage, 1, workerOptions));
    try {
      const result = await worker.recognize(data);
      return result.data.text;
    } catch {
      throw new AppError('document_ocr_unavailable');
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  }
}
