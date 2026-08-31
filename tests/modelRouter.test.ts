import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../server/infrastructure/deepseek/model-router.js';
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';

function client(label: string, seen: string[]): ModelClient {
  return {
    async *stream(_request: ModelRequest): AsyncIterable<{ type: 'delta'; content: string }> {
      seen.push(label);
      yield { type: 'delta', content: label };
    }
  };
}

test('routes fixed task types and falls back to the default client', async () => {
  const seen: string[] = [];
  const router = new ModelRouter(client('default', seen), {
    fast: client('fast', seen),
    structured: client('structured', seen)
  });
  const signal = new AbortController().signal;
  const collect = async (taskType?: ModelRequest['taskType']) => {
    const events = [];
    for await (const event of router.stream({ messages: [], tools: [], taskType }, signal)) events.push(event);
    return events;
  };

  assert.deepEqual(await collect('fast'), [{ type: 'delta', content: 'fast' }]);
  assert.deepEqual(await collect('structured'), [{ type: 'delta', content: 'structured' }]);
  assert.deepEqual(await collect('reasoning'), [{ type: 'delta', content: 'default' }]);
  assert.deepEqual(await collect(), [{ type: 'delta', content: 'default' }]);
  assert.deepEqual(seen, ['fast', 'structured', 'default', 'default']);
});

test('does not expose route configuration through the model request', async () => {
  let request: ModelRequest | undefined;
  const inner: ModelClient = {
    async *stream(input) {
      request = input;
      yield { type: 'delta', content: 'ok' };
    }
  };
  const router = new ModelRouter(inner);
  for await (const _event of router.stream({ messages: [], tools: [], taskType: 'fast' }, new AbortController().signal)) {
    // consume the stream
  }
  assert.equal(Object.hasOwn(request ?? {}, 'baseUrl'), false);
  assert.equal(Object.hasOwn(request ?? {}, 'apiKey'), false);
});
