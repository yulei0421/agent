import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('the production composition root uses the Nest chat path and never imports the legacy Express workflow', async () => {
  const [main, module] = await Promise.all([source('server/main.ts'), source('server/app.module.ts')]);

  assert.match(main, /AppModule\.forRoot/);
  assert.doesNotMatch(main, /from ['"].\/index\.js['"]/);
  assert.doesNotMatch(main, /from ['"].\/deepseek\.js['"]/);
  assert.match(module, /ChatController/);
  assert.match(module, /ChatApplicationService/);
  assert.match(module, /DeepSeekClient/);
  assert.match(module, /createToolRegistryExecutor/);
});

test('the old executable Express entrypoint has been removed', async () => {
  await assert.rejects(access(new URL('../server/index.ts', import.meta.url)));
});

test('application services do not depend on HTTP or Nest framework types', async () => {
  const [chatService, marketService] = await Promise.all([
    source('server/application/chat/chat.service.ts'),
    source('server/application/market/market-search.service.ts')
  ]);

  for (const implementation of [chatService, marketService]) {
    assert.doesNotMatch(implementation, /@nestjs\//);
    assert.doesNotMatch(implementation, /from ['"]express['"]/);
  }
});
