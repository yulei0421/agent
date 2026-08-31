import assert from 'node:assert/strict';
import test from 'node:test';
import { isAgentSseEvent, type AgentSseEvent, type ToolExecutionResult } from '../server/types.js';

test('shared agent event types validate the SSE contract', () => {
  const event: AgentSseEvent = { type: 'tool_result', name: 'get_weather', ok: true, result: {} };
  const result: ToolExecutionResult = { ok: false, name: 'get_weather', errorCode: 'request_aborted' };
  const plan: AgentSseEvent = {
    type: 'plan',
    currentStep: 0,
    completed: false,
    steps: [{ title: '查询数据', status: 'in_progress' }]
  };

  assert.equal(isAgentSseEvent(event), true);
  assert.equal(isAgentSseEvent(plan), true);
  assert.equal(isAgentSseEvent({ type: 'task', id: 'A'.repeat(32), status: 'running' }), true);
  assert.equal(isAgentSseEvent({ type: 'task', id: 'bad', status: 'running' }), false);
  assert.equal(isAgentSseEvent({ type: 'agent', role: 'researcher', status: 'started' }), true);
  assert.equal(isAgentSseEvent({ type: 'agent', role: 'unknown', status: 'started' }), false);
  assert.equal(isAgentSseEvent({
    type: 'approval',
    id: 'approval_abc123',
    calls: [{ name: 'get_weather', arguments: '{"city":"上海"}' }]
  }), true);
  assert.equal(isAgentSseEvent({ type: 'approval', id: 'x', calls: [{ name: '', arguments: '' }] }), false);
  assert.equal(isAgentSseEvent({ ...plan, currentStep: -1 }), false);
  assert.equal(result.ok, false);
});
