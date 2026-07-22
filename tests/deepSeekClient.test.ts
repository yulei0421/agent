import assert from 'node:assert/strict';
import test from 'node:test';
import { DeepSeekClient } from '../server/infrastructure/deepseek/deepseek-client.js';

test('streams parsed model events from the configured DeepSeek endpoint', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = new DeepSeekClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example',
    model: 'test-model',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
    }
  });

  const events = [];
  for await (const event of client.stream({ messages: [{ role: 'user', content: 'hello' }], tools: [] }, new AbortController().signal)) {
    events.push(event);
  }

  assert.equal(requests[0]?.url, 'https://model.example/chat/completions');
  assert.match(String(requests[0]?.init?.headers && (requests[0]?.init.headers as Record<string, string>).Authorization), /test-key/);
  assert.deepEqual(events, [{ type: 'delta', content: '你好' }, { type: 'done' }]);
});

test('throws a bounded provider error for non-success responses', async () => {
  const client = new DeepSeekClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example',
    model: 'test-model',
    fetchImpl: async () => new Response('upstream unavailable', { status: 503 })
  });

  await assert.rejects(async () => {
    for await (const _event of client.stream({ messages: [], tools: [] }, new AbortController().signal)) {
      // The call fails before a model event can be emitted.
    }
  }, { code: 'model_unavailable' });
});
