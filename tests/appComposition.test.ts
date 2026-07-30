import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatApplicationService } from '../server/application/chat/chat.service.js';
import { MODEL_CLIENT, TOOL_EXECUTOR } from '../server/application/chat/chat.ports.js';
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
  } finally {
    await app.close();
  }
});
