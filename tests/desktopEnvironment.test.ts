import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveDesktopEnvironmentFile } from '../electron/environment.js';
import { createSidecarEnvironment } from '../electron/sidecar.js';
import { loadConfiguredEnv } from '../server/env.js';

test('loads the desktop env file explicitly instead of relying on the sidecar cwd', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-agent-env-'));
  const file = join(directory, '.env');
  await writeFile(file, 'DEEPSEEK_API_KEY=test-desktop-key\nDEEPSEEK_MODEL=deepseek-chat\n');
  const environment = { AGENT_ENV_FILE: file } as NodeJS.ProcessEnv;
  try {
    loadConfiguredEnv(environment);
    assert.equal(environment.DEEPSEEK_API_KEY, 'test-desktop-key');
    assert.equal(environment.DEEPSEEK_MODEL, 'deepseek-chat');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('forwards the explicit env file when Electron launches the sidecar', () => {
  const environment = createSidecarEnvironment({ PATH: '/usr/bin' }, {
    port: 45678,
    origin: 'http://127.0.0.1:45678',
    token: 'desktop-token-1234567890',
    rendererDir: '/tmp/renderer',
    environmentFile: '/Users/test/Library/Application Support/DeepSeek Agent/.env'
  });
  assert.equal(environment.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(environment.AGENT_ENV_FILE, '/Users/test/Library/Application Support/DeepSeek Agent/.env');
  assert.equal(environment.PATH, '/usr/bin');
  assert.equal(environment.PORT, '45678');
  assert.equal(environment.CLIENT_URL, 'http://127.0.0.1:45678');
  assert.equal(environment.DESKTOP_SESSION_TOKEN, 'desktop-token-1234567890');
  assert.equal(environment.STATIC_RENDERER_DIR, '/tmp/renderer');
});

test('finds the branded desktop env file when Electron userData uses the package name', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-agent-desktop-paths-'));
  const actualUserData = join(directory, 'deepseek-agent-demo');
  const brandedUserData = join(directory, 'DeepSeek Agent');
  const brandedEnvironmentFile = join(brandedUserData, '.env');
  await mkdir(brandedUserData, { recursive: true });
  await writeFile(brandedEnvironmentFile, 'DEEPSEEK_API_KEY=test-key\n');
  try {
    assert.equal(resolveDesktopEnvironmentFile({
      userDataDirectory: actualUserData,
      brandedUserDataDirectory: brandedUserData,
      applicationDirectory: join(directory, 'app.asar')
    }), brandedEnvironmentFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a missing explicitly configured desktop env file', () => {
  assert.throws(() => resolveDesktopEnvironmentFile({
    configuredFile: '/missing/deepseek-agent.env',
    userDataDirectory: '/tmp/deepseek-agent-demo',
    brandedUserDataDirectory: '/tmp/DeepSeek Agent',
    applicationDirectory: '/tmp/app.asar'
  }), /AGENT_ENV_FILE does not exist/u);
});
