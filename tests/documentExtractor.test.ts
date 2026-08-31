import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';
import test from 'node:test';
import { PdfOcrDocumentExtractor } from '../server/infrastructure/documents/document-extractor.js';

function fakeWorker(text: string): unknown {
  return {
    async recognize() { return { data: { text } }; },
    async terminate() {}
  };
}

async function blankPdf(): Promise<Buffer> {
  const document = new PDFDocument();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.once('end', () => resolve(Buffer.concat(chunks)));
    document.once('error', reject);
  });
  document.end();
  return done;
}

test('runs OCR for an image through an injectable worker', async () => {
  const canvas = createCanvas(160, 60);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, 160, 60);
  const extractor = new PdfOcrDocumentExtractor({
    ocrLanguage: 'eng',
    workerFactory: async () => fakeWorker('image text') as never
  });
  const result = await extractor.extract({ mimeType: 'image/png', data: canvas.toBuffer('image/png') });
  assert.equal(result.text, 'image text');
  assert.equal(result.ocrUsed, true);
});

test('falls back to OCR for a PDF without a text layer', async () => {
  const extractor = new PdfOcrDocumentExtractor({
    ocrLanguage: 'eng',
    workerFactory: async () => fakeWorker('scanned page') as never
  });
  const result = await extractor.extract({ mimeType: 'application/pdf', data: await blankPdf() });
  assert.equal(result.text, '第1页：scanned page');
  assert.equal(result.pageCount, 1);
  assert.equal(result.ocrUsed, true);
});
