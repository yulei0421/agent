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
  for await (const event of client.stream({
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    responseFormat: { type: 'json_object' }
  }, new AbortController().signal)) {
    events.push(event);
  }

  assert.equal(requests[0]?.url, 'https://model.example/chat/completions');
  assert.match(String(requests[0]?.init?.headers && (requests[0]?.init.headers as Record<string, string>).Authorization), /test-key/);
  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.deepEqual(body, {
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    tool_choice: 'auto',
    stream: true,
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' }
  });
  assert.deepEqual(events, [{ type: 'delta', content: '你好' }, { type: 'done' }]);
});

test('omits response_format when the model request does not specify one', async () => {
  let body: Record<string, unknown> | undefined;
  const client = new DeepSeekClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example',
    model: 'test-model',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response('data: [DONE]\n\n', { status: 200 });
    }
  });

  for await (const _event of client.stream({ messages: [], tools: [] }, new AbortController().signal)) {
    // Consume the request so the mock captures its body.
  }

  assert.equal('response_format' in (body ?? {}), false);
});

test('reports request_aborted before calling a fetch implementation that ignores its signal', async () => {
  const controller = new AbortController();
  controller.abort();
  let fetchCalls = 0;
  const client = new DeepSeekClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example',
    model: 'test-model',
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('data: [DONE]\n\n', { status: 200 });
    }
  });

  await assert.rejects(async () => {
    for await (const _event of client.stream({ messages: [], tools: [] }, controller.signal)) {
      // The cancelled request must not emit an event.
    }
  }, { code: 'request_aborted' });
  assert.equal(fetchCalls, 0);
});

test('reports request_aborted when fetch aborts the signal before returning an empty response', async () => {
  const controller = new AbortController();
  const client = new DeepSeekClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example',
    model: 'test-model',
    fetchImpl: async () => {
      controller.abort();
      return new Response(null, { status: 200 });
    }
  });

  await assert.rejects(async () => {
    for await (const _event of client.stream({ messages: [], tools: [] }, controller.signal)) {
      // The cancelled request must not emit an event.
    }
  }, { code: 'request_aborted' });
});

test('checks cancellation again before yielding each parsed event', async () => {
  const controller = new AbortController();
  const client = new DeepSeekClient({
    apiKey: 'test-key',
    baseUrl: 'https://model.example',
    model: 'test-model',
    fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: [DONE]\n\n', { status: 200 })
  });
  const iterator = client.stream({ messages: [], tools: [] }, controller.signal)[Symbol.asyncIterator]();

  assert.deepEqual(await iterator.next(), { value: { type: 'delta', content: 'first' }, done: false });
  controller.abort();
  await assert.rejects(() => iterator.next(), { code: 'request_aborted' });
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
