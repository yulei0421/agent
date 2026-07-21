import assert from 'node:assert/strict';
import test from 'node:test';
import { isAgentSseEvent, type AgentSseEvent, type ToolExecutionResult } from '../server/types.js';

test('shared agent event types validate the SSE contract', () => {
  const event: AgentSseEvent = { type: 'tool_result', name: 'get_weather', ok: true, result: {} };
  const result: ToolExecutionResult = { ok: false, name: 'get_weather', errorCode: 'request_aborted' };

  assert.equal(isAgentSseEvent(event), true);
  assert.equal(result.ok, false);
});
