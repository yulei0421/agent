import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPolicy } from '../server/browser/browser-policy.js';
import { SandboxBrowserExecutor } from '../server/browser/browser-executor.js';

test('browser policy only allows configured public domains', async () => {
  const policy = new BrowserPolicy({ allowedDomains: ['example.com'] });
  assert.equal((await policy.assertUrlAllowed('https://www.example.com/path')).hostname, 'www.example.com');
  await assert.rejects(() => policy.assertUrlAllowed('http://127.0.0.1:8787'), { code: 'browser_denied' });
  await assert.rejects(() => policy.assertUrlAllowed('https://evil.example.net'), { code: 'browser_denied' });
});

test('browser executor requires human approval before click actions', async () => {
  const executor = new SandboxBrowserExecutor({ policy: new BrowserPolicy({ allowedDomains: ['example.com'] }) });
  await assert.rejects(() => executor.execute([{ type: 'click', selector: 'button' }], new AbortController().signal), { code: 'browser_denied' });
});
