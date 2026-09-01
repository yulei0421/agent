import assert from 'node:assert/strict';
import test from 'node:test';
import { createSidecarLaunchOptions, findAvailableLoopbackPort } from '../electron/sidecar.js';

test('desktop sidecar uses a random valid loopback port and an unguessable session token', async () => {
  const port = await findAvailableLoopbackPort();
  const options = createSidecarLaunchOptions(port, '/tmp/renderer', '/tmp/server.js');
  assert.ok(port > 0 && port <= 65535);
  assert.equal(options.origin, `http://127.0.0.1:${port}`);
  assert.match(options.token, /^[A-Za-z0-9_-]{32,}$/u);
  assert.equal(options.rendererDir, '/tmp/renderer');
});

test('desktop sidecar refuses invalid ports and empty resource paths', () => {
  assert.throws(() => createSidecarLaunchOptions(0, '/tmp/renderer', '/tmp/server.js'), /port/u);
  assert.throws(() => createSidecarLaunchOptions(45678, '', '/tmp/server.js'), /paths/u);
});
