import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fetchCapabilities } from '../src/lib/capabilities.js';

test('fetchCapabilities validates and freezes the public capability summary', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ capabilities: [{
    name: 'get_quote', kind: 'tool', version: '1.0.0', riskLevel: 'read_only', timeoutMs: 10_000, maxCalls: 6,
    taskTypes: ['fast', 'structured'], description: '查询报价', requiresApproval: false
  }] }), { status: 200 });
  try {
    const capabilities = await fetchCapabilities();
    assert.equal(capabilities[0]?.name, 'get_quote');
    assert.equal(Object.isFrozen(capabilities), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Sidebar renders the server-owned capability panel without executable fields', async () => {
  const source = await readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  assert.match(source, /Agent 能力/);
  assert.match(source, /capability\.description/);
  assert.doesNotMatch(source, /execute/);
});
