import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { PLANNER, type Planner } from '../server/application/chat/chat.ports.js';
import { createApp } from '../server/main.js';

test('the Nest composition root provides a planner function', async () => {
  const app = await createApp({
    PORT: '8787',
    CLIENT_URL: 'http://127.0.0.1:5173'
  });

  try {
    const planner = app.get<Planner>(PLANNER);

    assert.equal(typeof planner, 'function');
  } finally {
    await app.close();
  }
});

test('the Nest chat route reaches the application graph and returns an SSE terminal sequence', async () => {
  const app = await createApp({
    PORT: '8787',
    CLIENT_URL: 'http://127.0.0.1:5173'
  });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }] })
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.match(body, /"message":"model_unavailable"/);
    assert.doesNotMatch(body, /DEEPSEEK_API_KEY is not configured/);
    assert.match(body, /"type":"done"/);
  } finally {
    await app.close();
  }
});
