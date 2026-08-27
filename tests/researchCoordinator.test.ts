import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';
import { ResearchCoordinator } from '../server/agent/research-coordinator.js';

function scriptedModel(requests: ModelRequest[]): ModelClient {
  return {
    async *stream(request) {
      requests.push(request);
      const prompt = String((request.messages[0] as { content?: unknown } | undefined)?.content ?? '');
      if (prompt.includes('risk reviewer')) {
        yield { type: 'delta', content: '{"items":["检查数据新鲜度","检查来源一致性"]}' } as const;
      } else {
        yield { type: 'delta', content: '{"items":["获取报价和新闻","比较当前与历史数据"]}' } as const;
      }
      yield { type: 'done' } as const;
    }
  };
}

test('runs bounded research and risk delegates in parallel and returns server-owned planning notes', async () => {
  const requests: ModelRequest[] = [];
  const events: unknown[] = [];
  const coordinator = new ResearchCoordinator(scriptedModel(requests));

  const result = await coordinator.prepare({
    goal: '分析 AAPL 当前行情',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event)
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(result.messages.map((message) => message.role), ['system', 'system']);
  assert.match(result.messages[0]?.content ?? '', /researcher/);
  assert.match(result.messages[1]?.content ?? '', /risk_reviewer/);
  assert.deepEqual(events, [
    { type: 'agent', role: 'researcher', status: 'started' },
    { type: 'agent', role: 'risk_reviewer', status: 'started' },
    { type: 'agent', role: 'researcher', status: 'completed' },
    { type: 'agent', role: 'risk_reviewer', status: 'completed' }
  ]);
});

test('drops a failed delegate without failing the main request', async () => {
  const coordinator = new ResearchCoordinator({
    async *stream(request) {
      const prompt = String((request.messages[0] as { content?: unknown } | undefined)?.content ?? '');
      if (prompt.includes('risk reviewer')) throw new Error('delegate unavailable');
      yield { type: 'delta', content: '{"items":["获取报价"]}' } as const;
      yield { type: 'done' } as const;
    }
  });

  const result = await coordinator.prepare({
    goal: '研究 AAPL',
    signal: new AbortController().signal
  });

  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0]?.content ?? '', /获取报价/);
});
