import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeepSeekSseParser, formatSse, parseDeepSeekSse } from '../server/sse.js';

test('parses DeepSeek SSE delta chunks and done marker', () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
    'data: [DONE]\n\n'
  ];

  assert.deepEqual(parseDeepSeekSse(chunks.join('')), [
    { type: 'delta', content: '你' },
    { type: 'delta', content: '好' },
    { type: 'done' }
  ]);
});

test('parses DeepSeek reasoning chunks separately', () => {
  const chunk = 'data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n\n';

  assert.deepEqual(parseDeepSeekSse(chunk), [
    { type: 'reasoning', content: '思考中' }
  ]);
});

test('joins multiple SSE data lines before parsing and preserves done', () => {
  const stream = [
    'data: {"choices":[{"delta":',
    'data: {"tool_calls":[{"index":0,"id":"call_weather","function":{"name":"get_weather","arguments":"{}"}}]}}]}',
    '',
    'data: [DONE]',
    ''
  ].join('\n');

  assert.deepEqual(parseDeepSeekSse(stream), [
    {
      type: 'tool_call_delta',
      index: 0,
      id: 'call_weather',
      name: 'get_weather',
      arguments: '{}'
    },
    { type: 'done' }
  ]);
});

test('parses tool call deltas split across DeepSeek SSE chunks', () => {
  const chunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather","function":{"name":"get_weather","arguments":"{\\\"city\\\":\\\""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Beijing\\\"}"}}]}}]}\n\n'
  ];

  assert.deepEqual(parseDeepSeekSse(chunks.join('')), [
    {
      type: 'tool_call_delta',
      index: 0,
      id: 'call_weather',
      name: 'get_weather',
      arguments: '{"city":"'
    },
    {
      type: 'tool_call_delta',
      index: 0,
      arguments: 'Beijing"}'
    }
  ]);
});

test('buffers tool call SSE events when a CRLF delimiter is fragmented', () => {
  const events = [];
  const parser = createDeepSeekSseParser((event) => events.push(event));

  parser.push(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather","function":{"name":"get_weather","arguments":"{}"}},{"index":1,"id":"call_time","function":{"name":"get_time","arguments":"{}"}}]}}]}\r\n\r'
  );
  parser.push('\n');

  assert.deepEqual(events, [
    {
      type: 'tool_call_delta',
      index: 0,
      id: 'call_weather',
      name: 'get_weather',
      arguments: '{}'
    },
    {
      type: 'tool_call_delta',
      index: 1,
      id: 'call_time',
      name: 'get_time',
      arguments: '{}'
    }
  ]);
});

test('parses CRLF separated DeepSeek stream chunks', () => {
  const stream = [
    'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}',
    'data: {"choices":[{"delta":{"content":"可以"}}]}',
    'data: [DONE]'
  ].join('\r\n\r\n');

  assert.deepEqual(parseDeepSeekSse(stream), [
    { type: 'delta', content: '可以' },
    { type: 'done' }
  ]);
});

test('formats frontend SSE events', () => {
  assert.equal(formatSse({ type: 'delta', content: 'ok' }), 'data: {"type":"delta","content":"ok"}\n\n');
});
