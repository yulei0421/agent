import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import WebSocket from 'ws';
import { createApp } from '../server/main.js';

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
    socket.once('error', reject);
  });
}

test('Nest status gateway preserves the status and ping-pong WebSocket contract', async () => {
  const app = await createApp({ PORT: '8787', CLIENT_URL: 'http://127.0.0.1:5173' });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);

  try {
    const connected = await nextMessage(socket);
    assert.equal(connected.type, 'status');
    assert.equal(connected.status, 'connected');

    socket.send(JSON.stringify({ type: 'ping' }));
    const pong = await nextMessage(socket);
    assert.equal(pong.type, 'pong');
    assert.equal(typeof pong.at, 'number');
  } finally {
    socket.close();
    await app.close();
  }
});
