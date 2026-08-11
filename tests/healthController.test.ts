import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { HealthController } from '../server/api/health/health.controller.js';
import { AppConfigService, parseAppConfig } from '../server/infrastructure/config/app-config.service.js';
import { RuntimeTelemetry } from '../server/infrastructure/runtime/runtime-telemetry.js';
import { createApp } from '../server/main.js';

function config(environment: NodeJS.ProcessEnv = {}): AppConfigService {
  return new AppConfigService(parseAppConfig({
    PORT: '8787',
    CLIENT_URL: 'http://127.0.0.1:5173',
    ...environment
  }));
}

test('liveness returns a stable payload without reading model or external state', () => {
  const telemetry = {
    modelStatus: () => {
      throw new Error('liveness must not inspect runtime state');
    }
  } as unknown as RuntimeTelemetry;

  const controller = new HealthController(telemetry, config());
  assert.deepEqual(controller.check(), { status: 'ok' });
});

test('readiness reports a configured closed model as ready and an open circuit as unavailable', () => {
  const telemetry = new RuntimeTelemetry();
  telemetry.setModelConfigured(true);
  const statuses: number[] = [];
  const response = { status: (status: number) => statuses.push(status) } as never;

  const withoutKey = new HealthController(telemetry, config());
  assert.deepEqual(withoutKey.ready(response), { status: 'not_ready', model: 'not_configured' });
  assert.deepEqual(statuses, [503]);

  statuses.length = 0;
  const configured = new HealthController(telemetry, config({ DEEPSEEK_API_KEY: 'test-key' }));
  assert.deepEqual(configured.ready(response), { status: 'ready', model: 'ready' });
  assert.deepEqual(statuses, []);

  telemetry.setModelCircuit('open');
  assert.deepEqual(configured.ready(response), { status: 'not_ready', model: 'circuit_open' });
  assert.deepEqual(statuses, [503]);
});

test('health, readiness, and metrics are local runtime-only endpoints', async () => {
  const app = await createApp({
    PORT: '8787',
    CLIENT_URL: 'http://127.0.0.1:5173'
  });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;

  try {
    const telemetry = app.get(RuntimeTelemetry);
    telemetry.recordHttp('private user prompt', 200, 1);
    telemetry.recordTool('private user prompt', true, 1);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const [health, ready, metrics] = await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/ready`),
      fetch(`${baseUrl}/api/metrics`)
    ]);
    const metricsBody = await metrics.text();

    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: 'not_ready', model: 'not_configured' });
    assert.equal(metrics.headers.get('content-type'), 'text/plain; version=0.0.4; charset=utf-8');
    assert.match(metricsBody, /agent_model_requests_total/);
    assert.match(metricsBody, /agent_model_configured 0/);
    assert.doesNotMatch(metricsBody, /DEEPSEEK_API_KEY|private user prompt/);
  } finally {
    await app.close();
  }
});
