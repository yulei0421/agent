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
    deepSeekModel: 'deepseek-v4-flash',
    ocrLanguage: 'chi_sim+eng',
    modelResilience: {
      totalTimeoutMs: 60000,
      firstEventTimeoutMs: 15000,
      idleTimeoutMs: 30000,
      maxRetries: 1,
      circuitFailureThreshold: 3,
      circuitCooldownMs: 30000
    }
  });
});

test('accepts only a safe absolute PDF CJK font path', () => {
  assert.equal(parseAppConfig({ PDF_CJK_FONT_PATH: '/usr/share/fonts/NotoSansCJK-Regular.ttc' }).pdfFontPath, '/usr/share/fonts/NotoSansCJK-Regular.ttc');
  assert.throws(() => parseAppConfig({ PDF_CJK_FONT_PATH: 'relative/font.ttf' }));
  assert.throws(() => parseAppConfig({ PDF_CJK_FONT_PATH: '/font\nnext.ttf' }));
});

test('normalizes OCR settings and rejects unsafe language or asset paths', () => {
  const config = parseAppConfig({
    OCR_LANGUAGE: 'eng+chi_sim',
    TESSERACT_LANG_PATH: '/opt/tesseract/lang',
    TESSERACT_WORKER_PATH: '/opt/tesseract/worker.js',
    TESSERACT_CORE_PATH: '/opt/tesseract/core.wasm.js'
  });
  assert.equal(config.ocrLanguage, 'eng+chi_sim');
  assert.equal(config.tesseractLangPath, '/opt/tesseract/lang');
  assert.throws(() => parseAppConfig({ OCR_LANGUAGE: 'eng;rm' }));
  assert.throws(() => parseAppConfig({ TESSERACT_CORE_PATH: 'relative/core.js' }));
});

test('validates model resilience configuration boundaries', () => {
  assert.deepEqual(parseAppConfig({
    MODEL_TOTAL_TIMEOUT_MS: '100',
    MODEL_FIRST_EVENT_TIMEOUT_MS: '120000',
    MODEL_IDLE_TIMEOUT_MS: '100',
    MODEL_MAX_RETRIES: '0',
    MODEL_CIRCUIT_FAILURE_THRESHOLD: '20',
    MODEL_CIRCUIT_COOLDOWN_MS: '120000'
  }).modelResilience, {
    totalTimeoutMs: 100,
    firstEventTimeoutMs: 120000,
    idleTimeoutMs: 100,
    maxRetries: 0,
    circuitFailureThreshold: 20,
    circuitCooldownMs: 120000
  });

  for (const environment of [
    { MODEL_TOTAL_TIMEOUT_MS: '99' },
    { MODEL_FIRST_EVENT_TIMEOUT_MS: '120001' },
    { MODEL_IDLE_TIMEOUT_MS: '1.5' },
    { MODEL_MAX_RETRIES: '2' },
    { MODEL_CIRCUIT_FAILURE_THRESHOLD: '0' },
    { MODEL_CIRCUIT_COOLDOWN_MS: 'not-a-number' }
  ]) {
    assert.throws(() => parseAppConfig(environment));
  }
});

test('enables a fallback model only when its complete configuration is present', () => {
  assert.deepEqual(parseAppConfig({
    MODEL_FALLBACK_API_KEY: 'fallback-key',
    MODEL_FALLBACK_BASE_URL: 'https://fallback.example/',
    MODEL_FALLBACK_NAME: 'fallback-model'
  }).modelFallback, {
    apiKey: 'fallback-key',
    baseUrl: 'https://fallback.example',
    model: 'fallback-model'
  });

  for (const environment of [
    { MODEL_FALLBACK_API_KEY: 'fallback-key' },
    { MODEL_FALLBACK_BASE_URL: 'https://fallback.example' },
    { MODEL_FALLBACK_NAME: 'fallback-model' },
    { MODEL_FALLBACK_API_KEY: 'fallback-key', MODEL_FALLBACK_BASE_URL: 'not-a-url', MODEL_FALLBACK_NAME: 'fallback-model' }
  ]) {
    assert.throws(() => parseAppConfig(environment));
  }
});

test('accepts complete task-specific model route configuration', () => {
  assert.deepEqual(parseAppConfig({
    MODEL_FAST_API_KEY: 'fast-key',
    MODEL_FAST_BASE_URL: 'https://fast.example/',
    MODEL_FAST_NAME: 'fast-model',
    MODEL_REASONING_API_KEY: 'reason-key',
    MODEL_REASONING_BASE_URL: 'https://reason.example',
    MODEL_REASONING_NAME: 'reason-model'
  }).modelRoutes, {
    fast: { apiKey: 'fast-key', baseUrl: 'https://fast.example', model: 'fast-model' },
    reasoning: { apiKey: 'reason-key', baseUrl: 'https://reason.example', model: 'reason-model' }
  });
  assert.throws(() => parseAppConfig({ MODEL_FAST_API_KEY: 'fast-key' }));
  assert.throws(() => parseAppConfig({ MODEL_STRUCTURED_BASE_URL: 'https://structured.example' }));
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
