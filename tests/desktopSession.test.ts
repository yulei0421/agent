import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAppConfig } from '../server/infrastructure/config/app-config.service.js';
import { createApp } from '../server/main.js';
import WebSocket from 'ws';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('accepts a desktop session token and static renderer directory only as a pair', () => {
  const config = parseAppConfig({
    PORT: '45678',
    CLIENT_URL: 'http://127.0.0.1:45678',
    DESKTOP_SESSION_TOKEN: 'desktop-token-1234567890',
    STATIC_RENDERER_DIR: '/tmp/renderer'
  });
  assert.equal(config.desktopSessionToken, 'desktop-token-1234567890');
  assert.equal(config.staticRendererDir, '/tmp/renderer');

  assert.throws(
    () => parseAppConfig({ DESKTOP_SESSION_TOKEN: 'desktop-token-1234567890' }),
    /DESKTOP_SESSION_TOKEN and STATIC_RENDERER_DIR/
  );
});

test('desktop sidecar closes WebSocket clients without its session token', async () => {
  const app = await createApp({
    PORT: '45678',
    CLIENT_URL: 'http://127.0.0.1:45678',
    DESKTOP_SESSION_TOKEN: 'desktop-token-1234567890',
    STATIC_RENDERER_DIR: '/tmp/renderer'
  });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  try {
    const closeCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => resolve(-1), 250);
      socket.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    assert.equal(closeCode, 1008);
  } finally {
    socket.close();
    await app.close();
  }
});

test('desktop sidecar rejects API requests without its session token', async () => {
  const app = await createApp({
    PORT: '45678',
    CLIENT_URL: 'http://127.0.0.1:45678',
    DESKTOP_SESSION_TOKEN: 'desktop-token-1234567890',
    STATIC_RENDERER_DIR: '/tmp/renderer'
  });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/capabilities`);
    assert.equal(response.status, 401);
  } finally {
    await app.close();
  }
});

test('desktop sidecar serves the packaged renderer from its local origin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-agent-renderer-'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Desktop renderer</title>');
  const app = await createApp({
    PORT: '45678',
    CLIENT_URL: 'http://127.0.0.1:45678',
    DESKTOP_SESSION_TOKEN: 'desktop-token-1234567890',
    STATIC_RENDERER_DIR: directory
  });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Desktop renderer/u);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
