import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { findAvailableLoopbackPort } from '../electron/sidecar.js';

test('compiled desktop sidecar stays alive and serves the health endpoint', async () => {
  const root = join(process.cwd());
  const entry = join(root, 'dist-server', 'server', 'bootstrap.js');
  const rendererDir = join(root, 'dist');
  assert.ok(existsSync(entry), 'run pnpm build:server before packaged sidecar tests');
  assert.ok(existsSync(rendererDir), 'run pnpm build before packaged sidecar tests');

  const port = await findAvailableLoopbackPort();
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      CLIENT_URL: `http://127.0.0.1:${port}`,
      DESKTOP_SESSION_TOKEN: 'desktop-token-1234567890',
      STATIC_RENDERER_DIR: rendererDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const errors: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));

  try {
    const deadline = Date.now() + 5_000;
    let response: Response | undefined;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) break;
      } catch {
        // The sidecar may still be initializing.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(response?.status, 200, Buffer.concat(errors).toString('utf8'));
  } finally {
    if (child.exitCode === null) {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      });
    }
  }
});
