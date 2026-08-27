import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';
import { AppError } from '../server/domain/errors/app-error.js';
import { FailoverModelClient } from '../server/infrastructure/deepseek/failover-model-client.js';

function clientFrom(
  implementation: (request: ModelRequest, signal: AbortSignal) => AsyncIterable<Awaited<ReturnType<ModelClient['stream']>> extends AsyncIterable<infer Event> ? Event : never>
): ModelClient {
  return { stream: implementation };
}

async function collect(client: ModelClient, signal = new AbortController().signal): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of client.stream({ messages: [], tools: [] }, signal)) events.push(event);
  return events;
}

test('switches to the fallback model when the primary fails before producing output', async () => {
  let fallbackCalls = 0;
  const primary = clientFrom(async function* () {
    throw new AppError('model_unavailable');
  });
  const fallback = clientFrom(async function* () {
    fallbackCalls += 1;
    yield { type: 'delta', content: '备用回答' } as const;
    yield { type: 'done' } as const;
  });

  const events = await collect(new FailoverModelClient(primary, fallback));

  assert.deepEqual(events, [{ type: 'delta', content: '备用回答' }, { type: 'done' }]);
  assert.equal(fallbackCalls, 1);
});

test('does not switch after the primary has produced any event', async () => {
  let fallbackCalls = 0;
  const primary = clientFrom(async function* () {
    yield { type: 'delta', content: '部分回答' } as const;
    throw new AppError('model_unavailable');
  });
  const fallback = clientFrom(async function* () {
    fallbackCalls += 1;
    yield { type: 'delta', content: '不应出现' } as const;
  });

  await assert.rejects(() => collect(new FailoverModelClient(primary, fallback)), { code: 'model_unavailable' });
  assert.equal(fallbackCalls, 0);
});

test('does not switch a cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  let fallbackCalls = 0;
  const primary = clientFrom(async function* () {
    throw new AppError('request_aborted');
  });
  const fallback = clientFrom(async function* () {
    fallbackCalls += 1;
    yield { type: 'done' } as const;
  });

  await assert.rejects(() => collect(new FailoverModelClient(primary, fallback), controller.signal), { code: 'request_aborted' });
  assert.equal(fallbackCalls, 0);
});
