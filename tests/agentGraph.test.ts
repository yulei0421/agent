import assert from 'node:assert/strict';
import test from 'node:test';
import { createOnlineAgentGraph, createPlanningGraph } from '../server/agent/graph.js';
import type { Planner } from '../server/agent/state.js';
import type { ToolExecutor } from '../server/domain/tools/tool.types.js';

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

test('planning graph converts a planner rejection into an error and one done event', async () => {
  const graph = createPlanningGraph(async () => {
    throw new Error('planner offline');
  });

  const state = await graph.invoke({ goal: '制定计划' });

  assert.equal(state.finalized, true);
  assert.equal(state.terminated, false);
  assert.deepEqual(state.events.map((event) => event.type), ['error', 'done']);
  assert.equal(state.events[0]?.type === 'error' ? state.events[0].message : '', 'planner offline');
});

test('planning graph converts a synchronous planner throw into an error and one done event', async () => {
  const planner: Planner = () => {
    throw new Error('planner crashed before returning a promise');
  };
  const graph = createPlanningGraph(planner);

  const state = await graph.invoke({ goal: '制定计划' });

  assert.equal(state.finalized, true);
  assert.equal(state.terminated, false);
  assert.deepEqual(state.events.map((event) => event.type), ['error', 'done']);
  assert.equal(
    state.events[0]?.type === 'error' ? state.events[0].message : '',
    'planner crashed before returning a promise'
  );
});

test('planning graph rejects invalid planner items as a controlled error', async () => {
  const planner = async () => [null] as unknown as readonly string[];
  const graph = createPlanningGraph(planner);

  const state = await graph.invoke({ goal: '制定计划' });

  assert.equal(state.finalized, true);
  assert.deepEqual(state.events.map((event) => event.type), ['error', 'done']);
  assert.equal(state.events[0]?.type === 'error' ? state.events[0].message.includes('TypeError') : false, false);
});

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
