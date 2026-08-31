import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SseEventWriter } from '../server/api/chat/sse-event-writer.js';

class FakeResponse extends EventEmitter {
  readonly headers = new Map<string, string>();
  readonly writes: string[] = [];
  writableEnded = false;
  statusCode: number | undefined;
  flushCount = 0;
  endCount = 0;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }

  flushHeaders(): void {
    this.flushCount += 1;
  }

  write(value: string): boolean {
    this.writes.push(value);
    return true;
  }

  end(): this {
    this.endCount += 1;
    this.writableEnded = true;
    return this;
  }
}

function createWriter(response = new FakeResponse()) {
  const telemetry = { disconnects: 0, recordSseDisconnect() { this.disconnects += 1; } };
  return { response, telemetry, writer: new SseEventWriter(response as never, telemetry) };
}

test('SseEventWriter opens the established SSE response before streaming events', () => {
  const { response, writer } = createWriter();

  writer.open();

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform');
  assert.equal(response.headers.get('Connection'), 'keep-alive');
  assert.equal(response.flushCount, 1);
});

test('SseEventWriter formats events, writes done once, and ignores events after done', () => {
  const { response, writer } = createWriter();

  writer.open();
  writer.write({ type: 'delta', content: 'first' });
  writer.done();
  writer.done();
  writer.write({ type: 'error', message: 'late_failure' });

  assert.deepEqual(response.writes, [
    'data: {"type":"delta","content":"first"}\n\n',
    'data: {"type":"done"}\n\n'
  ]);
});

test('SseEventWriter stops writing and records telemetry when the client disconnects', () => {
  const { response, telemetry, writer } = createWriter();

  writer.open();
  response.emit('close');
  writer.write({ type: 'delta', content: 'late' });
  writer.done();

  assert.equal(telemetry.disconnects, 1);
  assert.deepEqual(response.writes, []);
});

test('SseEventWriter does not write ended responses and finishes at most once', () => {
  const { response, writer } = createWriter();

  writer.open();
  response.writableEnded = true;
  writer.write({ type: 'delta', content: 'late' });
  writer.done();
  writer.finish();
  writer.finish();

  assert.deepEqual(response.writes, []);
  assert.equal(response.endCount, 0);
});

test('SseEventWriter ends an active response only once', () => {
  const { response, writer } = createWriter();

  writer.open();
  writer.finish();
  writer.finish();

  assert.equal(response.endCount, 1);
});

test('SseEventWriter emits keep-alive comments and clears them on finish', async () => {
  const { response, writer } = createWriter();
  const heartbeatWriter = new SseEventWriter(response as never, { recordSseDisconnect() {} }, { heartbeatMs: 1 });

  heartbeatWriter.open();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(response.writes.some((value) => value === ': keep-alive\n\n'), true);
  heartbeatWriter.done();
  const count = response.writes.length;
  heartbeatWriter.finish();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(response.writes.length, count);
  writer.finish();
});
