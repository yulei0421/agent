import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';
import { AppError } from '../server/domain/errors/app-error.js';
import { ResilientModelClient } from '../server/infrastructure/deepseek/resilient-model-client.js';
import { RuntimeTelemetry } from '../server/infrastructure/runtime/runtime-telemetry.js';
import type { DeepSeekSseEvent } from '../server/sse.js';

const request: ModelRequest = { messages: [{ role: 'user', content: 'private user prompt' }], tools: [] };
const options = {
  totalTimeoutMs: 500,
  firstEventTimeoutMs: 100,
  idleTimeoutMs: 100,
  maxRetries: 1 as const,
  circuitFailureThreshold: 2,
  circuitCooldownMs: 100
};

async function collect(stream: AsyncIterable<DeepSeekSseEvent>): Promise<DeepSeekSseEvent[]> {
  const events: DeepSeekSseEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function waitsForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}

function iterableFromIterator(iterator: AsyncIterator<DeepSeekSseEvent>): AsyncIterable<DeepSeekSseEvent> {
  return { [Symbol.asyncIterator]: () => iterator };
}

function fakeRuntime() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const advance = (durationMs: number) => {
    now += durationMs;
    for (const [id, timer] of [...timers].sort((left, right) => left[1].at - right[1].at)) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.callback();
    }
  };
  return {
    runtime: {
      now: () => now,
      setTimeout: (callback: () => void, durationMs: number) => {
        const id = nextId;
        nextId += 1;
        timers.set(id, { at: now + durationMs, callback });
        return id;
      },
      clearTimeout: (id: unknown) => timers.delete(id as number)
    },
    advance
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

test('preserves a parent cancellation before invoking the wrapped client', async () => {
  let calls = 0;
  const inner: ModelClient = {
    async *stream() {
      calls += 1;
      yield { type: 'done' };
    }
  };
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() => collect(new ResilientModelClient(inner, new RuntimeTelemetry(), options).stream(request, controller.signal)), {
    code: 'request_aborted'
  });
  assert.equal(calls, 0);
});

test('checks parent cancellation after next resolves before recording success', async () => {
  const controller = new AbortController();
  let resolveNext: ((result: IteratorResult<DeepSeekSseEvent>) => void) | undefined;
  const next = new Promise<IteratorResult<DeepSeekSseEvent>>((resolve) => {
    resolveNext = resolve;
  });
  const inner: ModelClient = {
    stream: () => iterableFromIterator({
      next: () => next,
      return: async () => ({ done: true, value: undefined })
    })
  };
  const telemetry = new RuntimeTelemetry();
  const pending = collect(new ResilientModelClient(inner, telemetry, options).stream(request, controller.signal));

  await new Promise((resolve) => setImmediate(resolve));
  resolveNext?.({ done: true, value: undefined });
  await Promise.resolve();
  controller.abort();

  await assert.rejects(() => pending, { code: 'request_aborted' });
  assert.doesNotMatch(telemetry.metrics(), /agent_model_requests_total\{outcome="success"\} [1-9]/);
});

test('checks parent cancellation after next resolves before yielding an event', async () => {
  const controller = new AbortController();
  let resolveNext: ((result: IteratorResult<DeepSeekSseEvent>) => void) | undefined;
  const next = new Promise<IteratorResult<DeepSeekSseEvent>>((resolve) => {
    resolveNext = resolve;
  });
  const inner: ModelClient = {
    stream: () => iterableFromIterator({
      next: () => next,
      return: async () => ({ done: true, value: undefined })
    })
  };
  const events: DeepSeekSseEvent[] = [];
  const stream = new ResilientModelClient(inner, new RuntimeTelemetry(), options).stream(request, controller.signal);
  const pending = (async () => {
    try {
      for await (const event of stream) events.push(event);
    } catch (error) {
      return error;
    }
    throw new Error('Expected request cancellation');
  })();

  await new Promise((resolve) => setImmediate(resolve));
  resolveNext?.({ done: false, value: { type: 'delta', content: 'must not escape' } });
  await Promise.resolve();
  controller.abort();

  const error = await pending;
  assert.equal((error as AppError).code, 'request_aborted');
  assert.deepEqual(events, []);
});

test('maps a first-event timeout to model_unavailable', async () => {
  const inner: ModelClient = {
    async *stream(_request, signal) {
      await waitsForAbort(signal);
    }
  };

  await assert.rejects(() => collect(new ResilientModelClient(inner, new RuntimeTelemetry(), options).stream(request, new AbortController().signal)), {
    code: 'model_unavailable'
  });
});

test('returns a bounded timeout when an upstream next and return never settle', { timeout: 600 }, async () => {
  const never = new Promise<never>(() => undefined);
  const inner: ModelClient = {
    stream: () => iterableFromIterator({
      next: () => never,
      return: () => never
    })
  };
  const client = new ResilientModelClient(inner, new RuntimeTelemetry(), { ...options, maxRetries: 0 });
  const result = await Promise.race([
    collect(client.stream(request, new AbortController().signal)).then(
      () => new Error('Expected a timeout'),
      (error: unknown) => error
    ),
    new Promise<'test deadline'>((resolve) => setTimeout(() => resolve('test deadline'), 400))
  ]);

  assert.notEqual(result, 'test deadline');
  assert.equal((result as AppError).code, 'model_unavailable');
});

test('enforces the total request timeout across retries', async () => {
  const inner: ModelClient = {
    async *stream(_request, signal) {
      await waitsForAbort(signal);
    }
  };
  const client = new ResilientModelClient(inner, new RuntimeTelemetry(), {
    ...options,
    totalTimeoutMs: 100,
    firstEventTimeoutMs: 500
  });

  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), {
    code: 'model_unavailable'
  });
});

test('maps an idle stream timeout to model_unavailable', async () => {
  const inner: ModelClient = {
    async *stream(_request, signal) {
      yield { type: 'delta', content: 'first' };
      await waitsForAbort(signal);
    }
  };

  await assert.rejects(() => collect(new ResilientModelClient(inner, new RuntimeTelemetry(), options).stream(request, new AbortController().signal)), {
    code: 'model_unavailable'
  });
});

test('retries one recoverable failure before any streamed output', async () => {
  let calls = 0;
  const inner: ModelClient = {
    async *stream() {
      calls += 1;
      if (calls === 1) throw new AppError('model_unavailable');
      yield { type: 'done' };
    }
  };
  const telemetry = new RuntimeTelemetry();

  assert.deepEqual(await collect(new ResilientModelClient(inner, telemetry, options).stream(request, new AbortController().signal)), [{ type: 'done' }]);
  assert.equal(calls, 2);
  assert.match(telemetry.metrics(), /agent_model_requests_total\{outcome="retry"\} 1/);
});

test('does not retry after yielding a streamed event', async () => {
  let calls = 0;
  const inner: ModelClient = {
    async *stream() {
      calls += 1;
      yield { type: 'delta', content: 'already sent' };
      throw new AppError('model_unavailable');
    }
  };

  await assert.rejects(() => collect(new ResilientModelClient(inner, new RuntimeTelemetry(), options).stream(request, new AbortController().signal)), {
    code: 'model_unavailable'
  });
  assert.equal(calls, 1);
});

test('opens the circuit after the configured consecutive recoverable failures', async () => {
  let calls = 0;
  const inner: ModelClient = {
    async *stream() {
      calls += 1;
      throw new AppError('model_unavailable');
    }
  };
  const telemetry = new RuntimeTelemetry();
  const client = new ResilientModelClient(inner, telemetry, { ...options, maxRetries: 0, circuitFailureThreshold: 2 });

  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  assert.equal(calls, 2);
  assert.equal(telemetry.modelStatus().circuit, 'open');
});

test('does not let an old successful request close a circuit opened by another request', async () => {
  let calls = 0;
  let releaseOldRequest: (() => void) | undefined;
  const oldRequestReady = new Promise<void>((resolve) => {
    releaseOldRequest = resolve;
  });
  const inner: ModelClient = {
    async *stream() {
      calls += 1;
      if (calls === 1) {
        await oldRequestReady;
        yield { type: 'done' };
        return;
      }
      throw new AppError('model_unavailable');
    }
  };
  const telemetry = new RuntimeTelemetry();
  const client = new ResilientModelClient(inner, telemetry, { ...options, maxRetries: 0, circuitFailureThreshold: 1 });
  const oldRequest = collect(client.stream(request, new AbortController().signal));

  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  releaseOldRequest?.();
  await oldRequest;

  assert.equal(telemetry.modelStatus().circuit, 'open');
});

test('bounds ordinary-failure cleanup before retrying a model request', { timeout: 600 }, async () => {
  let calls = 0;
  const scheduler = fakeRuntime();
  const inner: ModelClient = {
    stream: () => {
      calls += 1;
      return iterableFromIterator({
        next: async () => {
          throw new AppError('model_unavailable');
        },
        return: () => new Promise<IteratorResult<DeepSeekSseEvent>>(() => undefined)
      });
    }
  };
  const client = new ResilientModelClient(inner, new RuntimeTelemetry(), { ...options, maxRetries: 1, totalTimeoutMs: 200 }, scheduler.runtime);
  const outcome = collect(client.stream(request, new AbortController().signal)).then(
    () => new Error('Expected a model failure'),
    (error: unknown) => error
  );

  await flushPromises();
  scheduler.advance(200);
  await flushPromises();
  const result = await outcome;

  assert.equal((result as AppError).code, 'model_unavailable');
  assert.equal(calls, 1);
});

test('limits timeout cleanup handoff to the remaining total deadline', { timeout: 600 }, async () => {
  let calls = 0;
  const scheduler = fakeRuntime();
  const inner: ModelClient = {
    stream: () => {
      calls += 1;
      return iterableFromIterator({
        next: () => new Promise<IteratorResult<DeepSeekSseEvent>>(() => undefined),
        return: () => new Promise<IteratorResult<DeepSeekSseEvent>>(() => undefined)
      });
    }
  };
  const client = new ResilientModelClient(inner, new RuntimeTelemetry(), {
    ...options,
    totalTimeoutMs: 150,
    firstEventTimeoutMs: 100,
    maxRetries: 1
  }, scheduler.runtime);
  const outcome = collect(client.stream(request, new AbortController().signal)).then(
    () => new Error('Expected a model failure'),
    (error: unknown) => error
  );

  await flushPromises();
  scheduler.advance(100);
  await flushPromises();
  scheduler.advance(50);
  await flushPromises();
  const result = await outcome;

  assert.equal((result as AppError).code, 'model_unavailable');
  assert.equal(calls, 1);
});

test('records retrying model calls with per-attempt durations', async () => {
  let calls = 0;
  const scheduler = fakeRuntime();
  const inner: ModelClient = {
    async *stream() {
      calls += 1;
      scheduler.advance(80);
      if (calls === 1) throw new AppError('model_unavailable');
      yield { type: 'done' };
    }
  };
  const telemetry = new RuntimeTelemetry();
  const client = new ResilientModelClient(inner, telemetry, { ...options, firstEventTimeoutMs: 400, idleTimeoutMs: 400 }, scheduler.runtime);

  await collect(client.stream(request, new AbortController().signal));
  const metrics = telemetry.metrics();
  const failureDuration = Number(metrics.match(/agent_model_duration_milliseconds_total\{outcome="failure"\} (\d+)/)?.[1]);
  const successDuration = Number(metrics.match(/agent_model_duration_milliseconds_total\{outcome="success"\} (\d+)/)?.[1]);

  assert.equal(calls, 2);
  assert.match(metrics, /agent_model_requests_total\{outcome="failure"\} 1/);
  assert.match(metrics, /agent_model_requests_total\{outcome="retry"\} 1/);
  assert.match(metrics, /agent_model_requests_total\{outcome="success"\} 1/);
  assert.equal(failureDuration, 80);
  assert.equal(successDuration, 80);
});

test('closes the circuit after a successful cooldown probe', async () => {
  let calls = 0;
  const inner: ModelClient = {
    async *stream() {
      calls += 1;
      if (calls === 1) throw new AppError('model_unavailable');
      yield { type: 'done' };
    }
  };
  const telemetry = new RuntimeTelemetry();
  const client = new ResilientModelClient(inner, telemetry, { ...options, maxRetries: 0, circuitFailureThreshold: 1 });

  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  assert.equal(telemetry.modelStatus().circuit, 'open');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(await collect(client.stream(request, new AbortController().signal)), [{ type: 'done' }]);
  assert.equal(telemetry.modelStatus().circuit, 'closed');
});

test('reopens a half-open circuit when the consumer returns after the probe event', async () => {
  let calls = 0;
  const inner: ModelClient = {
    async *stream(_request, signal) {
      calls += 1;
      if (calls === 1) throw new AppError('model_unavailable');
      yield { type: 'delta', content: 'probe output' };
      await waitsForAbort(signal);
    }
  };
  const telemetry = new RuntimeTelemetry();
  const client = new ResilientModelClient(inner, telemetry, { ...options, maxRetries: 0, circuitFailureThreshold: 1 });

  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const probe = client.stream(request, new AbortController().signal)[Symbol.asyncIterator]();
  assert.deepEqual(await probe.next(), { value: { type: 'delta', content: 'probe output' }, done: false });
  await probe.return?.();

  assert.equal(telemetry.modelStatus().circuit, 'open');
});

test('restarts cooldown when a half-open probe is aborted after its first event', async () => {
  let calls = 0;
  const inner: ModelClient = {
    async *stream(_request, signal) {
      calls += 1;
      if (calls === 1) throw new AppError('model_unavailable');
      yield { type: 'delta', content: 'probe output' };
      await waitsForAbort(signal);
    }
  };
  const telemetry = new RuntimeTelemetry();
  const client = new ResilientModelClient(inner, telemetry, { ...options, maxRetries: 0, circuitFailureThreshold: 1 });

  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const controller = new AbortController();
  const probe = client.stream(request, controller.signal)[Symbol.asyncIterator]();
  assert.deepEqual(await probe.next(), { value: { type: 'delta', content: 'probe output' }, done: false });
  controller.abort();
  await assert.rejects(() => probe.next(), { code: 'request_aborted' });

  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  assert.equal(calls, 2);
  assert.equal(telemetry.modelStatus().circuit, 'open');
});

test('awaits asynchronous iterator cleanup after normal completion', async () => {
  let cleaned = false;
  const inner: ModelClient = {
    stream: () => iterableFromIterator({
      next: async () => ({ done: true, value: undefined }),
      return: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        cleaned = true;
        return { done: true, value: undefined };
      }
    })
  };

  assert.deepEqual(await collect(new ResilientModelClient(inner, new RuntimeTelemetry(), options).stream(request, new AbortController().signal)), []);
  assert.equal(cleaned, true);
});

test('cancels a hung normal-completion cleanup without waiting for return', { timeout: 600 }, async () => {
  const never = new Promise<never>(() => undefined);
  const controller = new AbortController();
  const inner: ModelClient = {
    stream: () => iterableFromIterator({
      next: async () => ({ done: true, value: undefined }),
      return: () => never
    })
  };
  const pending = collect(new ResilientModelClient(inner, new RuntimeTelemetry(), options).stream(request, controller.signal));
  setTimeout(() => controller.abort(), 10);
  const result = await Promise.race([
    pending.then(
      () => new Error('Expected request cancellation'),
      (error: unknown) => error
    ),
    new Promise<'test deadline'>((resolve) => setTimeout(() => resolve('test deadline'), 400))
  ]);

  assert.notEqual(result, 'test deadline');
  assert.equal((result as AppError).code, 'request_aborted');
});

test('awaits asynchronous iterator cleanup after an upstream failure', async () => {
  let cleaned = false;
  const inner: ModelClient = {
    stream: () => iterableFromIterator({
      next: async () => {
        throw new AppError('model_unavailable');
      },
      return: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        cleaned = true;
        return { done: true, value: undefined };
      }
    })
  };
  const client = new ResilientModelClient(inner, new RuntimeTelemetry(), { ...options, maxRetries: 0 });

  await assert.rejects(() => collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
  assert.equal(cleaned, true);
});

test('telemetry excludes prompt-like metadata from its public state and metrics', () => {
  const telemetry = new RuntimeTelemetry();
  const secret = 'private user prompt https://model.example/api?key=secret';
  telemetry.recordTool(secret, false, 12);
  telemetry.recordHttp(secret, 502, 34);
  telemetry.recordModel('failure', 56);

  assert.doesNotMatch(JSON.stringify(telemetry.modelStatus()), /private user prompt|model\.example|secret/);
  assert.doesNotMatch(telemetry.metrics(), /private user prompt|model\.example|secret/);
});
