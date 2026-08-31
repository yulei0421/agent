import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOCUMENT_TEXT, parseDocumentSummaries } from '../server/application/chat/document-input.js';

test('accepts bounded text document summaries and strips mutable input', () => {
  const input = [{ name: ' notes.md ', mimeType: 'text/markdown', text: '  研究摘要  ' }];
  const parsed = parseDocumentSummaries(input);
  assert.deepEqual(parsed, [{ name: 'notes.md', mimeType: 'text/markdown', text: '研究摘要' }]);
  assert.notEqual(parsed, input);
});

test('rejects non-text, malformed, oversized, and unsafe document summaries', () => {
  assert.equal(parseDocumentSummaries([{ name: 'report.pdf', mimeType: 'application/pdf', text: 'x' }]), null);
  assert.equal(parseDocumentSummaries([{ name: 'notes.md', mimeType: 'text/markdown', text: 'x'.repeat(MAX_DOCUMENT_TEXT + 1) }]), null);
  assert.equal(parseDocumentSummaries([{ name: 'notes.md', mimeType: 'text/markdown', text: 'see https://example.com' }]), null);
  assert.equal(parseDocumentSummaries([{ name: 'notes.md', mimeType: 'text/markdown', text: '10.0.0.1' }]), null);
  assert.equal(parseDocumentSummaries({ name: 'notes.md' }), null);
});

test('treats an omitted document list as empty', () => {
  assert.deepEqual(parseDocumentSummaries(undefined), []);
});
