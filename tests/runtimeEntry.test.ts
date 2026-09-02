import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production scripts start the Nest runtime instead of the legacy Express entrypoint', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.match(manifest.scripts?.server ?? '', /server\/bootstrap\.ts/);
  assert.match(manifest.scripts?.dev ?? '', /server\/bootstrap\.ts/);
  assert.doesNotMatch(manifest.scripts?.server ?? '', /server\/index\.ts/);
});

test('the executable bootstrap loads local environment configuration before starting Nest', async () => {
  const source = await readFile(new URL('../server/bootstrap.ts', import.meta.url), 'utf8');

  assert.match(source, /loadConfiguredEnv\(\)/);
  assert.match(source, /bootstrap\(\)/);
});

test('the Nest composition root registers the safe logger and chat streams use it', async () => {
  const [moduleSource, controllerSource] = await Promise.all([
    readFile(new URL('../server/app.module.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/api/chat/chat.controller.ts', import.meta.url), 'utf8')
  ]);

  assert.match(moduleSource, /AppLoggerService/);
  assert.match(controllerSource, /private readonly logger: AppLoggerService/);
  assert.match(controllerSource, /this\.logger\.error\(/);
  assert.doesNotMatch(controllerSource, /console\.error/);
});

test('the production runtime uses a Nest WebSocket gateway instead of a manual ws attachment', async () => {
  const [mainSource, gatewaySource] = await Promise.all([
    readFile(new URL('../server/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/api/status/status.gateway.ts', import.meta.url), 'utf8')
  ]);

  assert.match(mainSource, /useWebSocketAdapter\(new WsAdapter/);
  assert.doesNotMatch(mainSource, /attachWebSocket/);
  assert.match(gatewaySource, /@WebSocketGateway\(\{ path: '\/ws' \}\)/);
  assert.match(gatewaySource, /@SubscribeMessage\('ping'\)/);
  assert.match(gatewaySource, /handleConnection/);
});
