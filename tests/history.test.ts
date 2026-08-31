import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalMemory, buildModelMessages, normalizeInterruptedMessages, trimHistory } from '../src/lib/history.js';
import type { ModelHistoryMessage } from '../src/lib/history.js';

test('trimHistory keeps newest messages within max character budget', () => {
  const messages: ModelHistoryMessage[] = [
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

test('buildLocalMemory keeps bounded prior context and recent completed turns', () => {
  const memory = buildLocalMemory([
    { role: 'user', status: 'done', content: '我关注 AAPL 的风险。' },
    { role: 'assistant', status: 'done', content: '请结合最新报价和新闻判断。' },
    { role: 'assistant', status: 'streaming', content: '不应进入记忆' }
  ], '用户偏好简洁结论。');
  assert.match(memory, /此前记忆：用户偏好简洁结论/);
  assert.match(memory, /AAPL/);
  assert.doesNotMatch(memory, /不应进入记忆/);
});

test('buildModelMessages reserves a local memory message ahead of trimmed conversation', () => {
  const messages = buildModelMessages([
    { role: 'system', content: 'policy' },
    { role: 'user', status: 'done', content: '旧问题' },
    { role: 'assistant', status: 'done', content: '旧回答' },
    { role: 'user', status: 'done', content: '当前问题' }
  ], 80, '用户关注风险');
  assert.equal(messages[0]?.content, 'policy');
  assert.match(messages[1]?.content ?? '', /本地会话记忆/);
  assert.equal(messages.some((message) => message.content === '当前问题'), true);
});
