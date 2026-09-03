import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TEXT_ATTACHMENT_CHARS, normalizeTextAttachment, retrieveDocumentContext } from '../src/lib/attachments.js';

test('normalizes bounded local text attachments', () => {
  assert.deepEqual(normalizeTextAttachment(' notes.md ', '  收盘价与风险  '), { name: 'notes.md', content: '收盘价与风险' });
  assert.equal(normalizeTextAttachment('report.pdf', 'text'), null);
  assert.equal(normalizeTextAttachment('empty.txt', '   '), null);
  assert.equal(normalizeTextAttachment('large.txt', 'x'.repeat(MAX_TEXT_ATTACHMENT_CHARS + 1)), null);
});

test('preserves supported extensions when truncating long text attachment names', () => {
  for (const extension of ['txt', 'md', 'csv', 'json']) {
    const attachment = normalizeTextAttachment(`${'a'.repeat(129)}.${extension}`, '附件内容');
    const expectedName = `${'a'.repeat(95 - extension.length)}.${extension}`;

    assert.ok(attachment);
    assert.equal(attachment.name, expectedName);
    assert.equal(attachment.content, '附件内容');
  }
});

test('retrieves relevant bounded snippets from previously attached local documents', () => {
  const documents = [
    { name: 'risk.md', mimeType: 'text/markdown' as const, text: '风险提示：数据可能延迟。\n\n估值需要结合现金流。' },
    { name: 'prices.txt', mimeType: 'text/plain' as const, text: '收盘价 120。\n\n成交量温和放大。' }
  ];
  const result = retrieveDocumentContext(documents, '请总结风险提示');
  assert.equal(result.length, 2);
  assert.equal(result[0]?.name, 'risk.md');
  assert.match(result[0]?.text ?? '', /风险提示/);
});

test('deduplicates documents and keeps an empty-query retrieval bounded', () => {
  const duplicate = { name: 'notes.txt', mimeType: 'text/plain' as const, text: 'a'.repeat(900) };
  const result = retrieveDocumentContext([duplicate, duplicate], '', { maxDocuments: 1, maxCharsPerDocument: 300, chunkChars: 160 });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.text.length, 300);
});
