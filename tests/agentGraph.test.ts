import assert from 'node:assert/strict';
import test from 'node:test';
import { createOnlineAgentGraph, createPlanningGraph } from '../server/agent/graph.js';
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';
import type { ToolExecutor } from '../server/domain/tools/tool.types.js';
import type { DeepSeekSseEvent } from '../server/sse.js';

function scriptedModel(requests: ModelRequest[], ...scripts: readonly DeepSeekSseEvent[][]): ModelClient {
  return {
    async *stream(request) {
      requests.push(request);
      yield* (scripts[requests.length - 1] ?? []);
    }
  };
}

function weatherExecutor(): ToolExecutor {
  return {
    definitions: () => [{ type: 'function', function: { name: 'get_weather', description: 'weather', parameters: { type: 'object', properties: {}, additionalProperties: false } } }],
    execute: async (call) => ({ ok: true, name: call.name, result: { weather: 'sunny' } })
  };
}

function emptyTools(): ToolExecutor {
  return { definitions: () => [], execute: async (call) => ({ ok: true, name: call.name, result: {} }) };
}

function systemContents(request: ModelRequest | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    const record = message as { role?: unknown; content?: unknown };
    return record.role === 'system' && typeof record.content === 'string' ? [record.content] : [];
  });
}

test('LangGraph planning node bounds plan steps and initializes the current step', async () => {
  const graph = createPlanningGraph(async () => [
    '确认比较对象',
    '获取实时数据',
    '基于结果总结',
    '不应保留的第四步'
  ]);

  const state = await graph.invoke({ goal: '比较 AAPL 与 BTC 的风险' });

  assert.equal(state.goal, '比较 AAPL 与 BTC 的风险');
  assert.deepEqual(state.plan, ['确认比较对象', '获取实时数据', '基于结果总结']);
  assert.equal(state.currentStep, 0);
  assert.equal(state.terminated, false);
});

test('uses the current plan step only in server-owned model context and advances after a tool round', async () => {
  const requests: ModelRequest[] = [];
  const graph = createOnlineAgentGraph({
    planner: async () => ['查询天气', '根据结果总结'],
    model: scriptedModel(
      requests,
      [{ type: 'tool_call_delta', index: 0, id: 'weather', name: 'get_weather', arguments: '{"city":"上海"}' }, { type: 'done' }],
      [{ type: 'delta', content: '上海晴' }, { type: 'done' }]
    ),
    tools: weatherExecutor()
  });

  const state = await graph.invoke({ goal: '上海天气', messages: [{ role: 'user', content: '上海天气' }] });

  assert.match(systemContents(requests[0]).join('\n'), /查询天气/);
  assert.equal(systemContents(requests[1]).some((content) => content.includes('查询天气')), false);
  assert.match(systemContents(requests[1]).join('\n'), /根据结果总结/);
  assert.equal(state.currentStep, 1);
  assert.equal(state.events.some((event) => JSON.stringify(event).includes('查询天气')), false);
});

test('keeps two plan steps transient, advances one step per tool round, and forces a tool-free summary', async () => {
  const requests: ModelRequest[] = [];
  const trustedSystems = [
    { role: 'system' as const, content: 'Server policy' },
    { role: 'system' as const, content: 'Server tool guard' }
  ];
  const userMessage = { role: 'user' as const, content: '上海天气' };
  const graph = createOnlineAgentGraph({
    planner: async () => ['查询天气', '根据结果总结'],
    model: scriptedModel(
      requests,
      [{ type: 'tool_call_delta', index: 0, id: 'weather_1', name: 'get_weather', arguments: '{"city":"上海"}' }, { type: 'done' }],
      [{ type: 'tool_call_delta', index: 0, id: 'weather_2', name: 'get_weather', arguments: '{"city":"上海"}' }, { type: 'done' }],
      [{ type: 'delta', content: '上海晴' }, { type: 'done' }]
    ),
    tools: weatherExecutor()
  });

  const state = await graph.invoke({ goal: '上海天气', messages: [...trustedSystems, userMessage] });
  const firstMessages = requests[0]?.messages as Array<{ role?: string; content?: string }>;
  const secondMessages = requests[1]?.messages as Array<{ role?: string; content?: string }>;
  const thirdMessages = requests[2]?.messages as Array<{ role?: string; content?: string }>;

  assert.deepEqual(firstMessages.slice(0, 2), trustedSystems);
  assert.equal(firstMessages[2]?.role, 'system');
  assert.match(firstMessages[2]?.content ?? '', /查询天气/);
  assert.deepEqual(firstMessages[3], userMessage);
  assert.equal(systemContents(requests[0]).some((content) => content.includes('根据结果总结')), false);

  assert.deepEqual(secondMessages.slice(0, 2), trustedSystems);
  assert.equal(secondMessages[2]?.role, 'system');
  assert.match(secondMessages[2]?.content ?? '', /根据结果总结/);
  assert.deepEqual(secondMessages[3], userMessage);
  assert.equal(systemContents(requests[1]).some((content) => content.includes('查询天气')), false);

  assert.equal(requests[2]?.forceFinalAnswer, true);
  assert.deepEqual(requests[2]?.tools, []);
  assert.equal(thirdMessages.filter((message) => message.role === 'tool').length, 2);
  assert.equal(state.currentStep, 2);
  assert.equal(['查询天气', '根据结果总结'].every((step) => !JSON.stringify(state.events).includes(step)), true);
  assert.equal(['查询天气', '根据结果总结'].every((step) => !JSON.stringify(state.messages).includes(step)), true);
});

for (const [name, planner] of [
  ['a rejection', async () => { throw new Error('offline'); }],
  ['null', async () => null as unknown as readonly string[]],
  ['undefined', async () => undefined as unknown as readonly string[]],
  ['a non-string item', async () => [null] as unknown as readonly string[]]
] as const) {
  test(`continues with an empty plan when a Planner returns ${name}`, async () => {
    const requests: ModelRequest[] = [];
    const graph = createOnlineAgentGraph({
      planner,
      model: scriptedModel(requests, [{ type: 'delta', content: '你好' }, { type: 'done' }]),
      tools: emptyTools()
    });

    const state = await graph.invoke({
      goal: '你好',
      plan: ['过期步骤'],
      currentStep: 2,
      messages: [{ role: 'user', content: '你好' }]
    });

    assert.equal(requests.length, 1);
    assert.deepEqual(state.plan, []);
    assert.equal(state.currentStep, 0);
    assert.deepEqual(state.events.map((event) => event.type), ['delta', 'done']);
    assert.equal(state.events.some((event) => event.type === 'error'), false);
  });
}

test('routes a no-tool model response through evaluation before finalizing', async () => {
  let toolExecutions = 0;
  const tools: ToolExecutor = {
    definitions: () => [],
    execute: async (call) => {
      toolExecutions += 1;
      return { ok: true, name: call.name, result: {} };
    }
  };
  const graph = createOnlineAgentGraph({
    model: {
      async *stream() {
        yield { type: 'delta', content: '直接回答' } as const;
        yield { type: 'done' } as const;
      }
    },
    tools
  });

  const state = await graph.invoke({
    goal: '直接回答',
    messages: [{ role: 'user', content: '直接回答' }],
    toolRounds: 3
  });

  assert.equal(toolExecutions, 0);
  assert.equal(state.forceFinalAnswer, true);
  assert.deepEqual(state.events.map((event) => event.type), ['delta', 'done']);
  assert.equal(state.finalized, true);
});
