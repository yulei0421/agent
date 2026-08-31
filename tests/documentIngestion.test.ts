import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentIngestionService } from '../server/application/documents/document-ingestion.service.js';

function base64(value: Buffer): string {
  return value.toString('base64');
}

test('validates PDF magic bytes before invoking the extractor', async () => {
  let calls = 0;
  const service = new DocumentIngestionService({
    async extract() {
      calls += 1;
      return { text: 'never used', chunks: ['never used'], ocrUsed: false };
    }
  });
  await assert.rejects(() => service.ingest({ name: 'report.pdf', mimeType: 'application/pdf', data: base64(Buffer.from('not pdf')) }), { code: 'invalid_request' });
  assert.equal(calls, 0);
});

test('returns a bounded extracted document and preserves OCR metadata', async () => {
  const service = new DocumentIngestionService({
    async extract() {
      return { text: '  研究结论  ', chunks: ['  第一页  '.repeat(500)], pageCount: 2, ocrUsed: true };
    }
  });
  const result = await service.ingest({ name: 'report.pdf', mimeType: 'application/pdf', data: base64(Buffer.from('%PDF-1.7')) });
  assert.equal(result.sourceKind, 'pdf');
  assert.equal(result.sourceMimeType, 'application/pdf');
  assert.equal(result.pageCount, 2);
  assert.equal(result.ocrUsed, true);
  assert.equal(result.text, '研究结论');
  assert.ok(result.chunks?.every((chunk) => chunk.length <= 1_200));
});

test('maps extractor failures to a controlled error', async () => {
  const service = new DocumentIngestionService({
    async extract() {
      throw new Error('native parser details must not escape');
    }
  });
  await assert.rejects(() => service.ingest({ name: 'photo.png', mimeType: 'image/png', data: base64(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }), { code: 'internal_error' });
});
