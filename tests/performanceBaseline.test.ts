import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { LangGraphAgentRunner } from '../server/agent/langgraph-agent-runner.js';
import type { ModelClient } from '../server/application/chat/chat.ports.js';
import type { ToolExecutor } from '../server/domain/tools/tool.types.js';

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('synthetic agent latency stays within the local performance baseline', async () => {
  const model: ModelClient = {
    async *stream() {
      await pause(5);
      yield { type: 'delta', content: 'first' };
      await pause(5);
      yield { type: 'done' };
    }
  };
  const tools: ToolExecutor = {
    definitions: () => [],
    async execute() { await pause(5); return { ok: true, name: 'get_quote', result: {} }; }
  };
  const runner = new LangGraphAgentRunner({ model, tools });
  let firstEventAt = 0;
  const startedAt = performance.now();
  await runner.run({
    goal: 'synthetic', messages: [{ role: 'user', content: 'synthetic' }], ip: '', now: () => new Date(), signal: new AbortController().signal,
    onEvent: (event) => { if (event.type === 'delta' && firstEventAt === 0) firstEventAt = performance.now(); }
  });
  const completedAt = performance.now();

  assert.ok(firstEventAt > startedAt);
  assert.ok(firstEventAt - startedAt < 250, `first event ${firstEventAt - startedAt}ms exceeds baseline`);
  assert.ok(completedAt - startedAt < 500, `completion ${completedAt - startedAt}ms exceeds baseline`);
});
