import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TEXT_ATTACHMENT_CHARS, normalizeTextAttachment } from '../src/lib/attachments.js';

test('normalizes bounded local text attachments', () => {
  assert.deepEqual(normalizeTextAttachment(' notes.md ', '  收盘价与风险  '), { name: 'notes.md', content: '收盘价与风险' });
  assert.equal(normalizeTextAttachment('report.pdf', 'text'), null);
  assert.equal(normalizeTextAttachment('empty.txt', '   '), null);
  assert.equal(normalizeTextAttachment('large.txt', 'x'.repeat(MAX_TEXT_ATTACHMENT_CHARS + 1)), null);
});
