import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentSecurityService } from '../server/application/documents/document-security.service.js';

const input = { name: 'a.pdf', mimeType: 'application/pdf' as const, data: Buffer.from('%PDF-1.7') };

test('rejects encrypted PDFs before extraction', async () => {
  const service = new DocumentSecurityService();
  await assert.rejects(() => service.inspect({ ...input, data: Buffer.from('%PDF-1.7 /Encrypt /Standard') }), { code: 'document_rejected' });
});

test('enforces per-subject upload quota and returns a content hash', async () => {
  const service = new DocumentSecurityService({ maxBytesPerSubject: 10, maxDocumentsPerSubject: 2 });
  const first = await service.inspect({ ...input, subject: 'user-1' });
  assert.equal(first.sha256.length, 64);
  await assert.rejects(() => service.inspect({ ...input, subject: 'user-1' }), { code: 'document_rejected' });
});

test('fails closed when injected scanner rejects a document', async () => {
  const service = new DocumentSecurityService({ scanner: () => false });
  await assert.rejects(() => service.inspect({ ...input }), { code: 'document_rejected' });
});
