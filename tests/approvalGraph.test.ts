import assert from 'node:assert/strict';
import test from 'node:test';
import { LangGraphAgentRunner } from '../server/agent/langgraph-agent-runner.js';
import { InMemoryApprovalCoordinator } from '../server/agent/approval-coordinator.js';
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';
import type { ToolExecutor } from '../server/domain/tools/tool.types.js';
import type { AgentSseEvent } from '../server/types.js';

function modelClient(...responses: readonly (readonly { type: string; [key: string]: unknown }[])[]): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async *stream(request) {
      requests.push(request);
      for (const event of responses[requests.length - 1] ?? []) yield event as never;
    }
  };
}

function tools(executed: string[]): ToolExecutor {
  return {
    definitions: () => [],
    async execute(call) {
      executed.push(call.name);
      return { ok: true, name: call.name, result: {} };
    }
  };
}

async function waitFor<T>(condition: () => T | undefined, message: string): Promise<T> {
  const deadline = Date.now() + 200;
  while (Date.now() < deadline) {
    const value = condition();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

test('emits an approval event and pauses tool execution until the user approves', async () => {
  const model = modelClient(
    [{ type: 'tool_call_delta', index: 0, id: 'call_weather', name: 'get_weather', arguments: '{"city":"上海"}' }, { type: 'done' }],
    [{ type: 'delta', content: '天气已查询' }, { type: 'done' }]
  );
  const executed: string[] = [];
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 60_000 });
  const runner = new LangGraphAgentRunner({
    model,
    tools: tools(executed),
    approval: coordinator
  });
  const events: AgentSseEvent[] = [];

  const run = runner.run({
    goal: '上海天气',
    messages: [{ role: 'user', content: '上海天气' }],
    signal: new AbortController().signal,
    ip: '',
    review: true,
    now: () => new Date(),
    onEvent: (event) => events.push(event)
  });

  const approval = await waitFor<Extract<AgentSseEvent, { type: 'approval' }>>(
    () => events.find((event): event is Extract<AgentSseEvent, { type: 'approval' }> => event.type === 'approval'),
    'approval event was not emitted'
  );
  assert.deepEqual(approval.calls, [{ id: 'call_weather', name: 'get_weather', arguments: '{"city":"上海"}' }]);
  assert.equal(executed.length, 0);

  await coordinator.resolve(approval.id, { decision: 'approved' });
  await run;

  assert.deepEqual(executed, ['get_weather']);
  assert.equal(events.some((event) => event.type === 'delta'), true);
});

test('reports rejected tools as failed results and lets the model answer directly', async () => {
  const model = modelClient(
    [{ type: 'tool_call_delta', index: 0, id: 'call_quote', name: 'get_quote', arguments: '{"symbol":"AAPL"}' }, { type: 'done' }],
    [{ type: 'delta', content: '未获取外部行情' }, { type: 'done' }]
  );
  const executed: string[] = [];
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 60_000 });
  const runner = new LangGraphAgentRunner({
    model,
    tools: tools(executed),
    approval: coordinator
  });
  const events: AgentSseEvent[] = [];

  const run = runner.run({
    goal: 'AAPL 行情',
    messages: [{ role: 'user', content: 'AAPL 行情' }],
    signal: new AbortController().signal,
    ip: '',
    review: true,
    now: () => new Date(),
    onEvent: (event) => events.push(event)
  });

  const approval = await waitFor<Extract<AgentSseEvent, { type: 'approval' }>>(
    () => events.find((event): event is Extract<AgentSseEvent, { type: 'approval' }> => event.type === 'approval'),
    'approval event was not emitted'
  );
  await coordinator.resolve(approval.id, { decision: 'rejected' });
  await run;

  assert.deepEqual(executed, []);
  const rejection = events.find((event): event is Extract<AgentSseEvent, { type: 'tool_result' }> => event.type === 'tool_result' && event.name === 'get_quote');
  assert.equal(rejection?.ok, false);
  assert.equal(rejection?.errorCode, 'approval_rejected');
  assert.equal(events.some((event) => event.type === 'delta'), true);
});

test('keeps the automatic path unchanged when review mode is off', async () => {
  const model = modelClient(
    [{ type: 'tool_call_delta', index: 0, id: 'call_weather', name: 'get_weather', arguments: '{"city":"上海"}' }, { type: 'done' }],
    [{ type: 'delta', content: '天气已查询' }, { type: 'done' }]
  );
  const executed: string[] = [];
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 60_000 });
  const runner = new LangGraphAgentRunner({
    model,
    tools: tools(executed),
    approval: coordinator
  });

  const events = await runner.run({
    goal: '上海天气',
    messages: [{ role: 'user', content: '上海天气' }],
    signal: new AbortController().signal,
    ip: '',
    review: false,
    now: () => new Date()
  });

  assert.deepEqual(executed, ['get_weather']);
  assert.equal(events.some((event) => event.type === 'approval'), false);
});
