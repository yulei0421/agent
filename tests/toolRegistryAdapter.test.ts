import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolRegistryExecutor } from '../server/infrastructure/tools/tool-registry.adapter.js';

test('exposes the manifest tool definitions through the application executor contract', () => {
  const executor = createToolRegistryExecutor();
  const definitions = executor.definitions();

  assert.deepEqual(definitions.map((tool) => tool.function.name), [
    'get_weather',
    'search_news',
    'search_asset',
    'get_quote',
    'get_technical_indicators',
    'get_economic_calendar'
  ]);
  assert.ok(definitions.every((tool) => tool.function.parameters.additionalProperties === false));
});

test('delegates execution with a child abort signal and preserves the error code', async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const executor = createToolRegistryExecutor({
    webSearch: async (_query, options) => {
      receivedSignal = options.signal;
      throw { code: 'upstream_timeout' };
    }
  });

  const result = await executor.execute(
    { name: 'search_news', arguments: '{"query":"市场"}' },
    { signal: controller.signal }
  );

  assert.ok(receivedSignal);
  assert.notStrictEqual(receivedSignal, controller.signal);
  assert.deepEqual(result, {
    ok: false,
    name: 'search_news',
    errorCode: 'upstream_timeout'
  });
});
