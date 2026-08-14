import assert from 'node:assert/strict';
import test from 'node:test';
import { ResearchExportService } from '../server/application/export/research-export.service.js';
import type { ResearchReport } from '../shared/research-report.js';

const report: ResearchReport = {
  title: 'AAPL 研究摘要',
  conclusion: '短线波动仍需结合实时行情判断。',
  evidence: [{ claim: '报价处于近期区间内', source: 'yahoo-finance', observedAt: '2026-08-13T02:00:00.000Z' }],
  risks: ['数据可能延迟'],
  asOf: '2026-08-13T02:00:00.000Z'
};

test('exports a validated research report through the requested renderer only', async () => {
  const calls: unknown[] = [];
  const service = new ResearchExportService({
    async render(input) {
      calls.push(input);
      return { body: Buffer.from('document'), extension: input.format, mediaType: 'application/pdf' };
    }
  });

  const result = await service.export({ report, format: 'pdf' });

  assert.equal(result.body.toString(), 'document');
  assert.equal(result.extension, 'pdf');
  assert.deepEqual(calls, [{ report, format: 'pdf' }]);
});

test('rejects malformed reports and unknown export formats before rendering', async () => {
  let calls = 0;
  const service = new ResearchExportService({ async render() { calls += 1; return { body: Buffer.alloc(0), extension: 'pdf', mediaType: 'application/pdf' }; } });

  await assert.rejects(() => service.export({ report: { ...report, title: '' }, format: 'pdf' }), { code: 'invalid_request' });
  await assert.rejects(() => service.export({ report, format: 'docx' as never }), { code: 'invalid_request' });
  await assert.rejects(() => service.export({ report: { ...report, evidence: [{ claim: '详情见 https://untrusted.example', source: 'x' }] }, format: 'pdf' }), { code: 'invalid_request' });
  await assert.rejects(() => service.export({ report: { ...report, risks: ['回调地址为 2001:db8::1'] }, format: 'pdf' }), { code: 'invalid_request' });
  assert.equal(calls, 0);
});
