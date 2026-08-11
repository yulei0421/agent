import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';
import { AppError } from '../server/domain/errors/app-error.js';
import { isStepObject, ModelPlanner } from '../server/infrastructure/deepseek/model-planner.js';
import type { DeepSeekSseEvent } from '../server/sse.js';

function recordingModel(events: readonly DeepSeekSseEvent[]): ModelClient & { requests: ModelRequest[]; signals: AbortSignal[] } {
  const requests: ModelRequest[] = [];
  const signals: AbortSignal[] = [];
  return {
    requests,
    signals,
    async *stream(request, signal) {
      requests.push(request);
      signals.push(signal);
      yield* events;
    }
  };
}

function failingModel(error: Error): ModelClient {
  return {
    async *stream() {
      throw error;
    }
  };
}

test('ModelPlanner joins deltas and sends only the goal in a JSON-only, tool-free request', async () => {
  const model = recordingModel([
    { type: 'delta', content: '{"steps":["查询' },
    { type: 'reasoning', content: 'ignored' },
    { type: 'delta', content: '天气","总结结果"]}' },
    { type: 'done' }
  ]);
  const planner = new ModelPlanner(model);

  assert.deepEqual(await planner.plan('上海天气'), ['查询天气', '总结结果']);
  assert.equal(model.requests.length, 1);
  assert.deepEqual(model.requests[0]?.tools, []);
  assert.deepEqual(model.requests[0]?.responseFormat, { type: 'json_object' });
  assert.deepEqual(model.requests[0]?.messages, [
    {
      role: 'system',
      content: 'You are a server-side planner. Return only a JSON object with a "steps" array of up to three concise strings. Do not call tools or include markdown.'
    },
    { role: 'user', content: '上海天气' }
  ]);
});

test('ModelPlanner returns an empty plan for malformed output', async () => {
  assert.deepEqual(await new ModelPlanner(recordingModel([{ type: 'delta', content: 'not json' }])).plan('目标'), []);
  assert.deepEqual(await new ModelPlanner(recordingModel([{ type: 'delta', content: '{"steps":"not an array"}' }])).plan('目标'), []);
});

test('ModelPlanner accepts only own steps arrays', () => {
  assert.equal(isStepObject({ steps: ['own'] }), true);
  assert.equal(isStepObject(Object.create({ steps: ['inherited'] })), false);
});

test('ModelPlanner filters non-string steps and degrades non-abort model failures', async () => {
  const valid = recordingModel([{ type: 'delta', content: '{"steps":["查询",42,"总结"]}' }]);
  assert.deepEqual(await new ModelPlanner(valid).plan('目标'), ['查询', '总结']);
  assert.deepEqual(await new ModelPlanner(failingModel(new Error('provider offline'))).plan('目标'), []);
  assert.deepEqual(await new ModelPlanner(failingModel(new AppError('model_unavailable'))).plan('目标'), []);
});

test('ModelPlanner passes the abort signal through and preserves request cancellation', async () => {
  const controller = new AbortController();
  const model = recordingModel([{ type: 'delta', content: '{"steps":[]}' }]);
  await new ModelPlanner(model).plan('目标', controller.signal);
  assert.equal(model.signals[0], controller.signal);

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => new ModelPlanner(failingModel(new AppError('request_aborted'))).plan('目标', aborted.signal),
    { code: 'request_aborted' }
  );
  await assert.rejects(
    () => new ModelPlanner(failingModel(new AppError('request_aborted'))).plan('目标'),
    { code: 'request_aborted' }
  );
});
