import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ChatController } from '../server/api/chat/chat.controller.js';
import type { ChatApplicationService } from '../server/application/chat/chat.service.js';
import { ChatApplicationService as RealChatApplicationService } from '../server/application/chat/chat.service.js';
import type { AppLoggerService } from '../server/infrastructure/logging/app-logger.service.js';
import type { RuntimeTelemetry } from '../server/infrastructure/runtime/runtime-telemetry.js';

const logger = { info() {}, error() {} } as unknown as AppLoggerService;
const telemetry = { recordSseDisconnect() {} } as unknown as RuntimeTelemetry;

class FakeResponse extends EventEmitter {
  readonly headers = new Map<string, string>();
  readonly writes: string[] = [];
  writableEnded = false;
  statusCode: number | undefined;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }

  flushHeaders(): void {}

  write(value: string): boolean {
    this.writes.push(value);
    return true;
  }

  end(): this {
    this.writableEnded = true;
    return this;
  }
}

class FakeRequest extends EventEmitter {
  constructor(readonly body: unknown, readonly ip?: string) {
    super();
  }
}

test('chat controller streams application events with the established SSE contract', async () => {
  const received: { body?: unknown; ip?: string; signal?: AbortSignal }[] = [];
  const service = {
    async run(request: { messages?: unknown; context?: unknown; ip?: string; signal?: AbortSignal; onEvent?: (event: { type: 'delta' | 'done'; content?: string }) => void }) {
      received.push(request);
      request.onEvent?.({ type: 'delta', content: '你好' });
      request.onEvent?.({ type: 'done' });
      return [];
    }
  } as unknown as ChatApplicationService;
  const controller = new ChatController(service, logger, telemetry);
  const response = new FakeResponse();

  await controller.stream(
    new FakeRequest({ messages: [{ role: 'user', content: '你好' }] }, '203.0.113.7') as never,
    response as never,
    { messages: [{ role: 'user', content: '你好' }] },
    '203.0.113.7'
  );

  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform');
  assert.deepEqual(response.writes, [
    'data: {"type":"delta","content":"你好"}\n\n',
    'data: {"type":"done"}\n\n'
  ]);
  assert.equal(response.writableEnded, true);
  assert.equal(received[0]?.ip, '203.0.113.7');
});

test('chat controller completes a normal stream that returns without a done event', async () => {
  const service = {
    async run() {
      return [];
    }
  } as unknown as ChatApplicationService;
  const controller = new ChatController(service, logger, telemetry);
  const response = new FakeResponse();

  await controller.stream(new FakeRequest({}) as never, response as never);

  assert.deepEqual(response.writes, ['data: {"type":"done"}\n\n']);
  assert.equal(response.writableEnded, true);
});

test('chat controller aborts the application request when the client disconnects', async () => {
  let receivedSignal: AbortSignal | undefined;
  const service = {
    async run(request: { signal?: AbortSignal }) {
      receivedSignal = request.signal;
      return [];
    }
  } as unknown as ChatApplicationService;
  const controller = new ChatController(service, logger, telemetry);
  const response = new FakeResponse();
  const streaming = controller.stream(new FakeRequest({}) as never, response as never);

  response.emit('close');
  await streaming;

  assert.equal(receivedSignal?.aborted, true);
  assert.equal(response.writableEnded, true);
});

test('chat controller writes a model delta before the model stream completes', async () => {
  let releaseModel: () => void = () => undefined;
  let reachedPause: () => void = () => undefined;
  const modelPaused = new Promise<void>((resolve) => {
    reachedPause = resolve;
  });
  const model = {
    async *stream() {
      yield { type: 'delta' as const, content: '第一段' };
      reachedPause();
      await new Promise<void>((resolve) => {
        releaseModel = resolve;
      });
      yield { type: 'done' as const };
    }
  };
  const service = new RealChatApplicationService({
    runner: {
      async run(request) {
        const signal = request.signal ?? new AbortController().signal;
        void signal;
        for await (const event of model.stream()) {
          request.onEvent?.(event);
        }
        return [{ type: 'done' }];
      }
    }
  });
  const controller = new ChatController(service, logger, telemetry);
  const response = new FakeResponse();

  const streaming = controller.stream(
    new FakeRequest({ messages: [{ role: 'user', content: '你好' }] }) as never,
    response as never,
    { messages: [{ role: 'user', content: '你好' }] }
  );
  await modelPaused;

  assert.deepEqual(response.writes, ['data: {"type":"delta","content":"第一段"}\n\n']);

  releaseModel();
  await streaming;
  assert.deepEqual(response.writes.at(-1), 'data: {"type":"done"}\n\n');
});
