import assert from 'node:assert/strict';
import test from 'node:test';
import { collectResearchCitations } from '../shared/research-citations.js';

test('collects safe citation ids and provider sources from successful tool results', () => {
  const citations = collectResearchCitations([
    {
      type: 'tool_result',
      name: 'search_news',
      ok: true,
      result: {
        sources: [
          { citationId: 'news-1', title: '市场早报', publishedAt: '2026-08-18T01:00:00.000Z' },
          { citationId: 'https://unsafe.example', title: '不应进入账本' }
        ]
      }
    },
    {
      type: 'tool_result',
      name: 'get_quote',
      ok: true,
      result: { meta: { source: 'yahoo-finance', symbol: 'AAPL.US', asOf: '2026-08-18T01:00:00.000Z' } }
    },
    {
      type: 'tool_result',
      name: 'get_quote',
      ok: false,
      errorCode: 'tool_unavailable'
    }
  ]);

  assert.deepEqual(citations, [
    { id: 'news-1', label: '市场早报', observedAt: '2026-08-18T01:00:00.000Z' },
    { id: 'yahoo-finance', label: 'AAPL.US', observedAt: '2026-08-18T01:00:00.000Z' }
  ]);
});

test('marks citations stale using server-observed age metadata when requested', () => {
  const citations = collectResearchCitations([
    {
      type: 'tool_result',
      name: 'get_quote',
      ok: true,
      result: { meta: { source: 'yahoo-finance', symbol: 'AAPL.US', ageSeconds: 7200 } }
    }
  ], { now: new Date('2026-08-18T03:00:00.000Z') });
  assert.deepEqual(citations, [{
    id: 'yahoo-finance',
    label: 'AAPL.US',
    freshness: 'stale',
    expired: true
  }]);
});
