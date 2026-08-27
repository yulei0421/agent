import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryResearchDownloadStore } from '../server/infrastructure/export/research-download.store.js';

const document = {
  body: Buffer.from('%PDF-report'),
  extension: 'pdf' as const,
  mediaType: 'application/pdf' as const
};

test('creates a short-lived opaque download token and returns a defensive copy', () => {
  const store = new InMemoryResearchDownloadStore({ ttlMs: 1_000 });

  const created = store.create(document, 'financial-research.pdf', 10_000);
  const found = store.get(created.token, 10_500);

  assert.match(created.token, /^[A-Za-z0-9_-]{32,}$/u);
  assert.equal(created.filename, 'financial-research.pdf');
  assert.equal(created.expiresAt, 11_000);
  assert.deepEqual(found, {
    ...document,
    body: Buffer.from('%PDF-report'),
    filename: 'financial-research.pdf',
    expiresAt: 11_000
  });
  found?.body.write('X');
  assert.equal(store.get(created.token, 10_500)?.body.toString(), '%PDF-report');
});

test('does not serve expired or malformed tokens', () => {
  const store = new InMemoryResearchDownloadStore({ ttlMs: 1_000 });
  const created = store.create(document, 'financial-research.pdf', 10_000);

  assert.equal(store.get(created.token, 11_000), undefined);
  assert.equal(store.get('not-a-real-token', 10_500), undefined);
});
