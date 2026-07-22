import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/main.js';
import { parseAppConfig } from '../server/infrastructure/config/app-config.service.js';

test('rejects an invalid port and unsafe client URL', () => {
  assert.throws(() => parseAppConfig({ PORT: 'zero', CLIENT_URL: 'not-a-url' }));
  assert.throws(() => parseAppConfig({ PORT: '70000', CLIENT_URL: 'http://127.0.0.1:5173' }));
});

test('normalizes valid server configuration', () => {
  assert.deepEqual(parseAppConfig({
    PORT: '8788',
    CLIENT_URL: 'http://127.0.0.1:5173/',
    TRUST_PROXY: 'true',
    DEEPSEEK_API_KEY: 'test-key'
  }), {
    port: 8788,
    clientUrl: 'http://127.0.0.1:5173',
    trustProxy: true,
    deepSeekApiKey: 'test-key',
    deepSeekBaseUrl: 'https://api.deepseek.com',
    deepSeekModel: 'deepseek-v4-flash'
  });
});

test('builds the Nest application without opening a network listener', async () => {
  const app = await createApp({
    PORT: '8787',
    CLIENT_URL: 'http://127.0.0.1:5173',
    TRUST_PROXY: 'true'
  });
  assert.equal(app.getHttpAdapter().getInstance().get('trust proxy'), 1);
  await app.close();
});
