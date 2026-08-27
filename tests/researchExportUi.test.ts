import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { downloadResearchReport } from '../src/lib/research-export.js';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('clicks a server-owned download link after a successful export request', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const requests: { url: string; init?: RequestInit }[] = [];
  const clicked: { href?: string; download?: string }[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ downloadUrl: '/api/exports/research/download/token_123', filename: 'financial-research.pdf' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const link: { href?: string; download?: string; click: () => void; remove: () => void } = {
      click: () => clicked.push({ href: link.href, download: link.download }),
      remove: () => undefined
    };
    return link;
  } } });

  try {
    await downloadResearchReport({ title: '研究', conclusion: '结论', evidence: [], risks: [] }, 'pdf');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }

  assert.equal(requests[0]?.url, '/api/exports/research/pdf/link');
  assert.equal(requests[0]?.init?.method, 'POST');
  assert.deepEqual(clicked, [{ href: '/api/exports/research/download/token_123', download: 'financial-research.pdf' }]);
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
