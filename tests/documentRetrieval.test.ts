import assert from 'node:assert/strict';
import test from 'node:test';
import { retrieveDocumentContext } from '../server/application/chat/document-retrieval.js';

test('ranks request-scoped document snippets by cosine similarity and caps output', () => {
  const documents = retrieveDocumentContext([
    { name: 'noise.md', mimeType: 'text/markdown', text: '天气和旅游信息' },
    { name: 'market.md', mimeType: 'text/markdown', text: 'AAPL 财报显示营收增长。风险来自估值。' }
  ], 'AAPL 营收');
  assert.equal(documents[0]?.name, 'market.md');
  assert.ok(documents.every((document) => document.text.length <= 3_500));
  assert.ok(documents.every((document) => document.chunks === undefined));
});
