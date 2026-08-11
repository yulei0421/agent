import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server/main.js';

test('Nest responses expose a safe request ID for request-log correlation', async () => {
  const app = await createApp({ PORT: '8787', CLIENT_URL: 'http://127.0.0.1:5173' });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.match(response.headers.get('x-request-id') ?? '', /^[a-f0-9-]{36}$/u);
  } finally {
    await app.close();
  }
});
