import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { downloadResearchReport } from '../src/lib/research-export.js';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('downloads only a successful server document response as a Blob attachment', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalDocument = globalThis.document;
  const requests: { url: string; init?: RequestInit }[] = [];
  const clicked: string[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(Buffer.from('%PDF-report'), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="financial-research.pdf"' } });
  };
  URL.createObjectURL = () => 'blob:report';
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click: () => clicked.push('clicked'), remove: () => undefined }) } });

  try {
    await downloadResearchReport({ title: '研究', conclusion: '结论', evidence: [], risks: [] }, 'pdf');
  } finally {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalUrl;
    URL.revokeObjectURL = originalRevoke;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }

  assert.equal(requests[0]?.url, '/api/exports/research/pdf');
  assert.equal(requests[0]?.init?.method, 'POST');
  assert.equal(clicked.length, 1);
});

test('shows PDF and PPTX export actions only for parsed research reports', async () => {
  const [item, styles] = await Promise.all([
    source('../src/components/MessageItem.tsx'),
    source('../src/styles.css')
  ]);

  assert.match(item, /downloadResearchReport/);
  assert.match(item, /导出 PDF/);
  assert.match(item, /导出 PPTX/);
  assert.match(item, /message\.researchReport/);
  assert.match(item, /research-export-actions/);
  assert.match(styles, /\.research-export-actions/);
});
