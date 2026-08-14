import assert from 'node:assert/strict';
import test from 'node:test';
import { LangGraphAgentRunner } from '../server/agent/langgraph-agent-runner.js';
import { ChatApplicationService } from '../server/application/chat/chat.service.js';
import { ResearchExportService } from '../server/application/export/research-export.service.js';
import { AGENT_RUNNER, MODEL_CLIENT, TOOL_EXECUTOR, type AgentRunner } from '../server/application/chat/chat.ports.js';
import { createApp } from '../server/main.js';

test('Nest composition root provides the chat application through replaceable model and tool ports', async () => {
  const app = await createApp({
    PORT: '8787',
    CLIENT_URL: 'http://127.0.0.1:5173',
    DEEPSEEK_API_KEY: 'test-key'
  });

  try {
    assert.ok(app.get(ChatApplicationService));
    assert.ok(app.get(MODEL_CLIENT));
    assert.ok(app.get(TOOL_EXECUTOR));
    assert.ok(app.get(AGENT_RUNNER));
    assert.ok(app.get(ResearchExportService));
  } finally {
    await app.close();
  }
});

test('Nest composition root resolves the concrete runner and reaches its public terminal contract', async () => {
  const app = await createApp({
    PORT: '8787',
    CLIENT_URL: 'http://127.0.0.1:5173'
  });

  try {
    const runner = app.get<AgentRunner>(AGENT_RUNNER);
    const published: unknown[] = [];
    const events = await runner.run({
      goal: 'x',
      messages: [{ role: 'user', content: 'x' }],
      signal: new AbortController().signal,
      ip: '',
      now: () => new Date('2026-08-11T00:00:00.000Z'),
      onEvent: (event) => published.push(event)
    });

    assert.ok(runner instanceof LangGraphAgentRunner);
    assert.deepEqual(events, [
      { type: 'error', message: 'model_unavailable' },
      { type: 'done' }
    ]);
    assert.deepEqual(published, events);
  } finally {
    await app.close();
  }
});
