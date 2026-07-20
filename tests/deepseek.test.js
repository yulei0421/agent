import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatRequestBody, shouldStopStreaming } from '../server/deepseek.js';

test('DeepSeek request disables thinking so normal content streams immediately', () => {
  assert.deepEqual(createChatRequestBody('deepseek-v4-flash', [{ role: 'user', content: '你好' }]), {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: '你好' }],
    stream: true,
    thinking: { type: 'disabled' }
  });
});

test('stream loop does not stop just because the request body was consumed', () => {
  assert.equal(shouldStopStreaming({ destroyed: false, writableEnded: false }), false);
  assert.equal(shouldStopStreaming({ destroyed: true, writableEnded: false }), true);
  assert.equal(shouldStopStreaming({ destroyed: false, writableEnded: true }), true);
});
