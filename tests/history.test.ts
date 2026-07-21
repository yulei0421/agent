import assert from 'node:assert/strict';
import test from 'node:test';
import { buildModelMessages, normalizeInterruptedMessages, trimHistory } from '../src/lib/history.js';

test('trimHistory keeps newest messages within max character budget', () => {
  const messages = [
    { role: 'user', content: 'old-12345' },
    { role: 'assistant', content: 'middle' },
    { role: 'user', content: 'latest' }
  ];

  assert.deepEqual(trimHistory(messages, 12), [
    { role: 'assistant', content: 'middle' },
    { role: 'user', content: 'latest' }
  ]);
});

test('normalizeInterruptedMessages converts stale streaming assistant messages', () => {
  assert.deepEqual(normalizeInterruptedMessages([
    { id: 'a1', role: 'assistant', status: 'streaming', content: '' },
    { id: 'u1', role: 'user', status: 'done', content: '你好' }
  ]), [
    { id: 'a1', role: 'assistant', status: 'stopped', content: '上次生成被中断。' },
    { id: 'u1', role: 'user', status: 'done', content: '你好' }
  ]);
});

test('buildModelMessages removes interrupted and empty assistant messages', () => {
  assert.deepEqual(buildModelMessages([
    { role: 'system', content: 'sys' },
    { role: 'user', status: 'done', content: '你好' },
    { role: 'assistant', status: 'stopped', content: '上次生成被中断。' },
    { role: 'assistant', status: 'done', content: '' },
    { role: 'assistant', status: 'done', content: '你好，有什么可以帮你？' },
    { role: 'user', status: 'done', content: '今天星期几' }
  ]), [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好，有什么可以帮你？' },
    { role: 'user', content: '今天星期几' }
  ]);
});
