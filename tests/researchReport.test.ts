import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResearchReport } from '../src/lib/research-report.js';

test('parses a bounded financial research report without exposing unexpected fields', () => {
  const report = parseResearchReport(JSON.stringify({
    title: 'AAPL 研究摘要',
    conclusion: '短线波动仍需结合实时行情判断。',
    evidence: [
      { claim: '报价处于近期区间内', source: 'yahoo-finance', observedAt: '2026-08-12T02:00:00.000Z', ignored: 'drop' }
    ],
    risks: ['数据可能延迟', '不构成投资建议'],
    asOf: '2026-08-12T02:00:00.000Z',
    injected: 'drop'
  }));

  assert.deepEqual(report, {
    title: 'AAPL 研究摘要',
    conclusion: '短线波动仍需结合实时行情判断。',
    evidence: [{ claim: '报价处于近期区间内', source: 'yahoo-finance', observedAt: '2026-08-12T02:00:00.000Z' }],
    risks: ['数据可能延迟', '不构成投资建议'],
    asOf: '2026-08-12T02:00:00.000Z'
  });
});

test('rejects malformed, overlong, and prototype-controlled research reports', () => {
  assert.equal(parseResearchReport('not-json'), null);
  assert.equal(parseResearchReport(JSON.stringify({ title: 'x', conclusion: 'y', evidence: [], risks: [], asOf: 'not-a-date' })), null);
  assert.equal(parseResearchReport(JSON.stringify({ title: 'x'.repeat(121), conclusion: 'y', evidence: [], risks: [] })), null);
  assert.equal(parseResearchReport(Object.assign(Object.create({ title: 'x' }), { conclusion: 'y', evidence: [], risks: [] })), null);
});

test('accepts evidence only when its source is present in the current citation ledger', () => {
  const value = JSON.stringify({
    title: 'AAPL 研究',
    conclusion: '结论',
    evidence: [{ claim: '报价已更新', source: 'yahoo-finance' }],
    risks: []
  });

  assert.notEqual(parseResearchReport(value, { allowedSources: ['yahoo-finance'] }), null);
  assert.equal(parseResearchReport(value, { allowedSources: ['news-1'] }), null);
});
