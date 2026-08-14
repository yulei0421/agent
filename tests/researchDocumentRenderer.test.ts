import assert from 'node:assert/strict';
import test from 'node:test';
import { ResearchDocumentRenderer } from '../server/infrastructure/export/research-document-renderer.js';

const report = {
  title: 'AAPL 研究摘要',
  conclusion: '短线波动仍需结合实时行情判断。',
  evidence: [{ claim: '报价处于近期区间内', source: 'yahoo-finance', observedAt: '2026-08-13T02:00:00.000Z' }],
  risks: ['数据可能延迟'],
  asOf: '2026-08-13T02:00:00.000Z'
} as const;

test('renders PDF and editable PPTX buffers from only the validated report contract', async () => {
  const renderer = new ResearchDocumentRenderer({ fontPath: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf' });

  const [pdf, pptx] = await Promise.all([
    renderer.render({ report, format: 'pdf' }),
    renderer.render({ report, format: 'pptx' })
  ]);

  assert.equal(pdf.mediaType, 'application/pdf');
  assert.equal(pdf.extension, 'pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.body.length > 500);
  assert.equal(pptx.mediaType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(pptx.extension, 'pptx');
  assert.deepEqual([...pptx.body.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(pptx.body.length > 1_000);
});

test('fails safely when a PDF CJK font is not available', async () => {
  const renderer = new ResearchDocumentRenderer({ fontPath: '/missing/cjk-font.ttf' });
  await assert.rejects(() => renderer.render({ report, format: 'pdf' }), { code: 'internal_error' });
});
