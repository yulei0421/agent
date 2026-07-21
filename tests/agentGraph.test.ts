import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlanningGraph } from '../server/agent/graph.js';

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
