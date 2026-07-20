import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatRequestBody, shouldStopStreaming, streamDeepSeek } from '../server/deepseek.js';

function createSseResponse() {
  const writes = [];
  const closeListeners = new Set();
  return {
    destroyed: false,
    writableEnded: false,
    writes,
    writeHead() {},
    write(chunk) { writes.push(chunk); },
    end() { this.writableEnded = true; },
    status() { return this; },
    json() {},
    once(event, listener) {
      if (event === 'close') closeListeners.add(listener);
      return this;
    },
    off(event, listener) {
      if (event === 'close') closeListeners.delete(listener);
      return this;
    },
    disconnect() {
      this.destroyed = true;
      for (const listener of closeListeners) listener();
    }
  };
}

function upstreamEvents(...events) {
  return {
    ok: true,
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode(events.map((event) => `data: ${event}\n\n`).join(''));
      }
    }
  };
}

function withDeepSeekEnvironment(fn) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
    process.env.DEEPSEEK_API_KEY = originalKey;
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('DeepSeek request exposes supplied native tools and disables thinking', () => {
  const tools = [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }];
  assert.deepEqual(createChatRequestBody('deepseek-v4-flash', [{ role: 'user', content: '你好' }], tools), {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: '你好' }],
    tools,
    tool_choice: 'auto',
    stream: true,
    thinking: { type: 'disabled' }
  });
  assert.deepEqual(createChatRequestBody('deepseek-v4-flash', [], []), {
    model: 'deepseek-v4-flash',
    messages: [],
    tools: [],
    tool_choice: 'auto',
    stream: true,
    thinking: { type: 'disabled' }
  });
});

test('stream loop does not stop just because the request body was consumed', () => {
  assert.equal(shouldStopStreaming({ destroyed: false, writableEnded: false }), false);
  assert.equal(shouldStopStreaming({ destroyed: true, writableEnded: false }), true);
  assert.equal(shouldStopStreaming({ destroyed: false, writableEnded: true }), true);
});

test('streams fragmented model tool calls, executes them, and sends results to a second model request', async () => {
  await withDeepSeekEnvironment(async () => {
    const requestBodies = [];
    const registryCalls = [];
    const definitions = [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }];
    const now = () => new Date('2026-07-20T08:00:00.000Z');
    const toolRegistry = {
      definitions: () => definitions,
      async execute(call, context) {
        registryCalls.push({ call, context });
        return { ok: true, name: call.name, result: { weather: 'sunny' } };
      }
    };
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return requestBodies.length === 1
        ? upstreamEvents(
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather","type":"function","function":{"name":"get_weather","arguments":"{\\\"city\\\":\\\"上"}}]}}]}',
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"海\\\"}"}}]}}]}',
          '[DONE]'
        )
        : upstreamEvents('{"choices":[{"delta":{"content":"最终回答"}}]}', '[DONE]');
    };

    const res = createSseResponse();
    await streamDeepSeek({ ip: '203.0.113.8', body: { messages: [{ role: 'user', content: '上海天气' }] } }, res, {
      toolRegistry,
      now
    });

    assert.equal(requestBodies.length, 2);
    assert.deepEqual(requestBodies[0].tools, definitions);
    assert.equal(requestBodies[0].tool_choice, 'auto');
    assert.deepEqual(registryCalls[0].call, { id: 'call_weather', name: 'get_weather', arguments: '{"city":"上海"}' });
    assert.equal(registryCalls[0].context.ip, '203.0.113.8');
    assert.equal(registryCalls[0].context.now().toISOString(), '2026-07-20T08:00:00.000Z');
    assert.deepEqual(requestBodies[1].messages.at(-2), {
      role: 'assistant',
      tool_calls: [{
        id: 'call_weather',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"上海"}' }
      }]
    });
    assert.deepEqual(requestBodies[1].messages.at(-1), {
      role: 'tool',
      tool_call_id: 'call_weather',
      content: JSON.stringify({ ok: true, name: 'get_weather', result: { weather: 'sunny' } })
    });
    const events = res.writes.map((write) => JSON.parse(write.slice(6)));
    assert.deepEqual(events.map((event) => event.type), ['tool', 'tool_result', 'delta', 'done']);
    assert.equal(events[0].name, 'get_weather');
    assert.equal(events[1].name, 'get_weather');
    assert.equal(events[2].content, '最终回答');
  });
});

test('model-directed calls do not invoke legacy weather, news, or market pre-routing', async () => {
  await withDeepSeekEnvironment(async () => {
    const registryCalls = [];
    const toolRegistry = {
      definitions: () => [],
      async execute(call) {
        registryCalls.push(call);
        return { ok: true, name: call.name };
      }
    };
    globalThis.fetch = async () => upstreamEvents('{"choices":[{"delta":{"content":"由模型决定"}}]}', '[DONE]');
    const res = createSseResponse();

    await streamDeepSeek({ body: { webSearch: true, messages: [{ role: 'user', content: '上海天气和贵州茅台最新新闻行情' }] } }, res, {
      toolRegistry,
      liveContext: async () => { throw new Error('legacy live route called'); },
      webSearch: async () => { throw new Error('legacy news route called'); },
      marketGateway: { async getQuote() { throw new Error('legacy market route called'); } }
    });

    assert.deepEqual(registryCalls, []);
    const events = res.writes.map((write) => JSON.parse(write.slice(6)));
    assert.deepEqual(events.map((event) => event.type), ['delta', 'done']);
  });
});

test('forwards final text chunks before the upstream stream completes', async () => {
  await withDeepSeekEnvironment(async () => {
    const continueStream = deferred();
    globalThis.fetch = async () => ({
      ok: true,
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n');
          await continueStream.promise;
          yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\ndata: [DONE]\n\n');
        }
      }
    });
    const res = createSseResponse();
    let completed = false;
    const streaming = streamDeepSeek({ body: { messages: [{ role: 'user', content: '你好' }] } }, res, {
      toolRegistry: { definitions: () => [], async execute() { throw new Error('must not execute'); } }
    }).then(() => { completed = true; });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(completed, false);
    assert.deepEqual(res.writes.map((write) => JSON.parse(write.slice(6))), [{ type: 'delta', content: '第一段' }]);

    continueStream.resolve();
    await streaming;
    assert.deepEqual(res.writes.map((write) => JSON.parse(write.slice(6))).map((event) => event.type), ['delta', 'delta', 'done']);
  });
});

test('aborts the provider stream on disconnect without writing or executing tools afterwards', async () => {
  await withDeepSeekEnvironment(async () => {
    const releaseStream = deferred();
    let providerSignal;
    let fetchCount = 0;
    let executeCalls = 0;
    globalThis.fetch = async (_url, options) => {
      fetchCount += 1;
      if (fetchCount > 1) return upstreamEvents('[DONE]');
      providerSignal = options.signal;
      return {
        ok: true,
        body: {
          async *[Symbol.asyncIterator]() {
            yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n');
            await releaseStream.promise;
            yield new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_after_disconnect","function":{"name":"get_weather","arguments":"{}"}}]}}]}\n\n');
          }
        }
      };
    };
    const res = createSseResponse();
    const streaming = streamDeepSeek({ body: { messages: [{ role: 'user', content: '天气' }] } }, res, {
      toolRegistry: {
        definitions: () => [],
        async execute() { executeCalls += 1; return { ok: true }; }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const writesBeforeDisconnect = res.writes.length;
    res.disconnect();
    assert.equal(providerSignal.aborted, true);
    releaseStream.resolve();
    await streaming;

    assert.equal(executeCalls, 0);
    assert.equal(res.writes.length, writesBeforeDisconnect);
  });
});

test('ignores tool calls emitted after the upstream done sentinel', async () => {
  await withDeepSeekEnvironment(async () => {
    let fetchCount = 0;
    let executeCalls = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return fetchCount === 1
        ? upstreamEvents(
          '[DONE]',
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_after_done","function":{"name":"get_weather","arguments":"{}"}}]}}]}'
        )
        : upstreamEvents('[DONE]');
    };
    const res = createSseResponse();

    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '天气' }] } }, res, {
      toolRegistry: {
        definitions: () => [],
        async execute() { executeCalls += 1; return { ok: true }; }
      }
    });

    assert.equal(executeCalls, 0);
    assert.equal(fetchCount, 1);
    assert.deepEqual(res.writes.map((write) => JSON.parse(write.slice(6))), [{ type: 'done' }]);
  });
});

test('keeps disconnect cancellation active while a tool execution is in flight', async () => {
  await withDeepSeekEnvironment(async () => {
    const toolStarted = deferred();
    const releaseTool = deferred();
    let fetchCount = 0;
    let executionSignal;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return fetchCount === 1
        ? upstreamEvents(
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather","function":{"name":"get_weather","arguments":"{}"}}]}}]}',
          '[DONE]'
        )
        : upstreamEvents('{"choices":[{"delta":{"content":"不应请求"}}]}', '[DONE]');
    };
    const res = createSseResponse();
    const streaming = streamDeepSeek({ body: { messages: [{ role: 'user', content: '天气' }] } }, res, {
      toolRegistry: {
        definitions: () => [],
        async execute(_call, context) {
          executionSignal = context.signal;
          toolStarted.resolve();
          await releaseTool.promise;
          return { ok: true, name: 'get_weather' };
        }
      }
    });

    await toolStarted.promise;
    const writesBeforeDisconnect = res.writes.length;
    res.disconnect();
    assert.equal(executionSignal.aborted, true);
    releaseTool.resolve();
    await streaming;

    assert.equal(fetchCount, 1);
    assert.equal(res.writes.length, writesBeforeDisconnect);
  });
});

test('caps model tool calls and returns a tool-limit result before requesting a final answer', async () => {
  await withDeepSeekEnvironment(async () => {
    const requestBodies = [];
    const registryCalls = [];
    const calls = Array.from({ length: 7 }, (_, index) => ({
      index,
      id: `call_${index + 1}`,
      type: 'function',
      function: { name: 'get_weather', arguments: '{}' }
    }));
    const toolRegistry = {
      definitions: () => [],
      async execute(call) {
        registryCalls.push(call);
        return { ok: true, name: call.name };
      }
    };
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return requestBodies.length === 1
        ? upstreamEvents(JSON.stringify({ choices: [{ delta: { tool_calls: calls } }] }), '[DONE]')
        : upstreamEvents('{"choices":[{"delta":{"content":"限额后的回答"}}]}', '[DONE]');
    };
    const res = createSseResponse();

    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '天气' }] } }, res, { toolRegistry });

    assert.equal(requestBodies.length, 2);
    assert.equal(registryCalls.length, 6);
    assert.equal(requestBodies[1].messages.filter((message) => message.role === 'tool').length, 7);
    assert.deepEqual(requestBodies[1].messages.at(-1), {
      role: 'tool',
      tool_call_id: 'call_7',
      content: JSON.stringify({ ok: false, errorCode: 'tool_limit_reached' })
    });
    const events = res.writes.map((write) => JSON.parse(write.slice(6)));
    assert.equal(events.filter((event) => event.type === 'tool').length, 7);
    assert.deepEqual(events.filter((event) => event.type === 'tool_result').at(-1), {
      type: 'tool_result',
      id: 'call_7',
      name: 'get_weather',
      ok: false,
      errorCode: 'tool_limit_reached'
    });
  });
});

test('terminates when a forced final response still contains tool calls', async () => {
  await withDeepSeekEnvironment(async () => {
    const requestBodies = [];
    const registryCalls = [];
    const toolRegistry = {
      definitions: () => [],
      async execute(call) {
        registryCalls.push(call);
        return { ok: true, name: call.name };
      }
    };
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      const call = (id) => JSON.stringify({ choices: [{ delta: {
        tool_calls: [{ index: 0, id, type: 'function', function: { name: 'get_weather', arguments: '{}' } }]
      } }] });
      if (requestBodies.length <= 3) return upstreamEvents(call(`call_${requestBodies.length}`), '[DONE]');
      if (requestBodies.length === 4) return upstreamEvents(call('call_rejected'), '[DONE]');
      return upstreamEvents('{"choices":[{"delta":{"content":"不应继续请求"}}]}', '[DONE]');
    };
    const res = createSseResponse();

    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '天气' }] } }, res, { toolRegistry });

    assert.equal(requestBodies.length, 4);
    assert.deepEqual(registryCalls.map((call) => call.id), ['call_1', 'call_2', 'call_3']);
    const events = res.writes.map((write) => JSON.parse(write.slice(6)));
    assert.deepEqual(events.filter((event) => event.type === 'tool_result').at(-1), {
      type: 'tool_result',
      id: 'call_rejected',
      name: 'get_weather',
      ok: false,
      errorCode: 'tool_limit_reached'
    });
    assert.deepEqual(events.slice(-2), [
      { type: 'error', message: 'DeepSeek returned tool calls after tools were disabled' },
      { type: 'done' }
    ]);
  });
});

test('uses server error context for malformed tool chunks without fabricating assistant calls', async () => {
  await withDeepSeekEnvironment(async () => {
    const requestBodies = [];
    let executeCalls = 0;
    const toolRegistry = {
      definitions: () => [],
      async execute() { executeCalls += 1; return { ok: true }; }
    };
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return requestBodies.length === 1
        ? upstreamEvents('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_weather","arguments":"{}"}}]}}]}', '[DONE]')
        : upstreamEvents('{"choices":[{"delta":{"content":"已处理无效调用"}}]}', '[DONE]');
    };
    const res = createSseResponse();

    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '天气' }] } }, res, { toolRegistry });

    assert.equal(executeCalls, 0);
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[1].messages.some((message) => message.role === 'assistant' && message.tool_calls), false);
    assert.deepEqual(requestBodies[1].messages.at(-1), {
      role: 'system',
      content: '工具调用格式无效（invalid_tool_call）。请基于已有上下文直接回答，不要重试工具调用。'
    });
    const events = res.writes.map((write) => JSON.parse(write.slice(6)));
    assert.deepEqual(events[0], {
      type: 'tool_result', name: 'invalid_tool_call', ok: false, errorCode: 'invalid_tool_call'
    });
  });
});

test('forwards only one done event when the provider repeats [DONE]', async () => {
  await withDeepSeekEnvironment(async () => {
    globalThis.fetch = async () => upstreamEvents(
      '{"choices":[{"delta":{"content":"完成"}}]}',
      '[DONE]',
      '[DONE]'
    );
    const res = createSseResponse();

    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '你好' }] } }, res, {
      toolRegistry: { definitions: () => [], async execute() { throw new Error('must not execute'); } }
    });

    const events = res.writes.map((write) => JSON.parse(write.slice(6)));
    assert.equal(events.filter((event) => event.type === 'done').length, 1);
  });
});

test('ends promptly after the upstream done sentinel without waiting for an open tail', async () => {
  await withDeepSeekEnvironment(async () => {
    globalThis.fetch = async () => ({
      ok: true,
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('data: [DONE]\n\n');
          await new Promise(() => {});
        }
      }
    });
    const res = createSseResponse();
    const completion = streamDeepSeek({ body: { messages: [{ role: 'user', content: '你好' }] } }, res, {
      toolRegistry: { definitions: () => [], async execute() { throw new Error('must not execute'); } }
    });
    const result = await Promise.race([
      completion.then(() => 'completed'),
      new Promise((resolve) => setTimeout(() => resolve('timed_out'), 30))
    ]);

    assert.equal(result, 'completed');
    assert.deepEqual(res.writes.map((write) => JSON.parse(write.slice(6))), [{ type: 'done' }]);
  });
});
