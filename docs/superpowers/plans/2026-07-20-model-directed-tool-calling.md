# 模型自主工具调用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 DeepSeek 根据受控工具定义自主规划并多轮调用天气、新闻和行情工具，服务端验证及执行后将结果返回模型。

**Architecture:** 新增独立工具注册表，向模型提供 OpenAI 兼容的 `tools` 定义并由执行器校验参数、执行固定数据源和输出统一结果。聊天编排器改为最大三轮、总计六次调用的工具调用循环，流式解析器聚合原生 `tool_calls`，最终文本仍以现有 SSE 协议输出。

**Tech Stack:** Node.js ESM、DeepSeek OpenAI 兼容 Chat Completions API、Express、SSE、node:test。

---

### Task 1: 工具调用 SSE 解析

**Files:**
- Modify: `server/sse.js`
- Modify: `tests/sse.test.js`

- [ ] **Step 1: 写入失败测试，约束普通文本与分片工具调用同时可解析**

```js
test('parses tool-call chunks with id, name, and arguments', () => {
  const stream = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\\\"city\\\":\\\"上"}}]}}]}\\n\\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"海\\\"}"}}]}}]}\\n\\n'
  ].join('');
  assert.deepEqual(parseDeepSeekSse(stream), [
    { type: 'tool_call_delta', index: 0, id: 'call_1', name: 'get_weather', arguments: '{"city":"上' },
    { type: 'tool_call_delta', index: 0, arguments: '海"}' }
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/sse.test.js`

Expected: FAIL，因为解析器尚未输出 `tool_call_delta`。

- [ ] **Step 3: 在 `parseDeepSeekSse` 中映射 `delta.tool_calls`，保留每个调用的 index、id、名称与参数分片**

```js
const calls = json.choices?.[0]?.delta?.tool_calls;
if (Array.isArray(calls)) {
  return calls.map((call) => ({
    type: 'tool_call_delta', index: call.index,
    ...(typeof call.id === 'string' ? { id: call.id } : {}),
    ...(typeof call.function?.name === 'string' ? { name: call.function.name } : {}),
    ...(typeof call.function?.arguments === 'string' ? { arguments: call.function.arguments } : {})
  }));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/sse.test.js`

Expected: PASS。

### Task 2: 受控工具注册表与执行器

**Files:**
- Create: `server/tools/registry.js`
- Create: `tests/toolRegistry.test.js`
- Modify: `server/tools/live.js`
- Modify: `server/tools/market.js`

- [ ] **Step 1: 写入失败测试，约束公开定义、参数校验与未知工具拒绝**

```js
const registry = createToolRegistry({ liveContext, webSearch, marketGateway });
assert.deepEqual(registry.definitions().map((tool) => tool.function.name), [
  'get_weather', 'search_news', 'search_asset', 'get_quote'
]);
assert.deepEqual(await registry.execute({ name: 'get_weather', arguments: '{"city":"上海"}' }, { ip: '203.0.113.10' }), {
  ok: true, name: 'get_weather', result: expectedWeather
});
assert.equal((await registry.execute({ name: 'shell', arguments: '{}' })).errorCode, 'unknown_tool');
assert.equal((await registry.execute({ name: 'get_weather', arguments: '{"city":1}' })).errorCode, 'invalid_arguments');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/toolRegistry.test.js`

Expected: FAIL，因为 `registry.js` 不存在。

- [ ] **Step 3: 实现仅含 `get_weather`、`search_news`、`search_asset`、`get_quote` 的工具注册表**

```js
const definitions = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询指定城市或当前用户所在地的实时天气。',
    parameters: { type: 'object', properties: { city: { type: 'string', maxLength: 64 } }, additionalProperties: false }
  }
}];

async function execute(call, context) {
  const parsed = parseCall(call);
  if (!parsed.ok) return parsed;
  return handlers[parsed.name](parsed.arguments, context);
}
```

工具执行器必须：拒绝未知工具、无效 JSON、额外字段、超长字符串；复用 `resolveLiveContext`、`searchWeb`、`marketGateway` 和资产检索适配器；返回不含密钥、原始 IP 或任意 URL 的结构化数据。

- [ ] **Step 4: 运行注册表和既有底层工具测试**

Run: `node --test tests/toolRegistry.test.js tests/liveContext.test.js tests/marketTools.test.js tests/assetSearch.test.js`

Expected: PASS。

### Task 3: 多轮模型工具编排

**Files:**
- Modify: `server/deepseek.js`
- Modify: `tests/deepseek.test.js`
- Modify: `tests/webSearch.test.js`

- [ ] **Step 1: 写入失败测试，约束模型选择工具、结果回传与最终文本**

```js
await streamDeepSeek(req, res, { toolRegistry: registry });
assert.equal(requestBodies.length, 2);
assert.deepEqual(requestBodies[0].tools, registry.definitions());
assert.equal(requestBodies[1].messages.at(-2).role, 'assistant');
assert.equal(requestBodies[1].messages.at(-1).role, 'tool');
assert.match(res.writes.join(''), /"name":"get_weather"/);
assert.match(res.writes.join(''), /最终回答/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/deepseek.test.js tests/webSearch.test.js`

Expected: FAIL，因为当前请求没有 `tools`，且仅发送一次模型请求。

- [ ] **Step 3: 在请求 body 添加 `tools` 和 `tool_choice: 'auto'`，并让流解析器收集工具调用**

```js
function createChatRequestBody(model, messages, tools = []) {
  return { model, messages, tools, tool_choice: 'auto', stream: true, thinking: { type: 'disabled' };
}

const calls = new Map();
const parser = createDeepSeekSseParser((event) => {
  if (event.type === 'tool_call_delta') mergeToolCall(calls, event);
  if (event.type === 'delta') res.write(formatSse(event));
});
```

- [ ] **Step 4: 实现最大三轮、总计六次调用的循环，并在每次调用后追加标准 `assistant` / `tool` 消息**

```js
for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
  const completion = await requestCompletion(requestMessages, tools);
  if (completion.toolCalls.length === 0) return streamFinalText(completion);
  for (const call of completion.toolCalls.slice(0, remainingCalls)) {
    res.write(formatSse({ type: 'tool', name: call.name }));
    const executed = await toolRegistry.execute(call, { ip: getClientIp(req), now });
    res.write(formatSse({ type: 'tool_result', name: call.name, ...executed }));
    requestMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(executed) });
  }
}
```

超过配额时追加 `tool_limit_reached` 工具消息；工具失败也必须通过 `role: tool` 反馈给模型。移除 `isLiveDataRequest`、`isWeatherRequest`、`isNewsRequest`、`extractMarketSymbols` 和 `webSearch` 在聊天编排器中的预路由使用。

- [ ] **Step 5: 运行聊天相关测试确认通过**

Run: `node --test tests/deepseek.test.js tests/webSearch.test.js`

Expected: PASS，旧的预路由断言改为模型工具调用协议断言。

### Task 4: 接入生产依赖、界面记录与全量验证

**Files:**
- Modify: `server/index.js`
- Modify: `src/components/MessageItem.jsx`
- Modify: `tests/webSearch.test.js`
- Modify: `README.md`

- [ ] **Step 1: 写入失败测试，约束聊天入口传入注册表依赖且页面可显示新工具名称**

```js
assert.match(indexSource, /createToolRegistry/);
assert.match(itemSource, /search_asset/);
assert.match(itemSource, /get_quote/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/webSearch.test.js`

Expected: FAIL，因为入口尚未创建工具注册表。

- [ ] **Step 3: 创建并注入工具注册表，补齐工具记录显示和 README 使用说明**

```js
const toolRegistry = createToolRegistry({ marketGateway, assetSearch });
app.post('/api/chat/stream', (req, res) => streamDeepSeek(req, res, { toolRegistry }));
```

README 明确：模型只调用注册工具；后端验证并执行；模型不能产生或执行任意代码；工具调用受轮数、总数和超时限制。

- [ ] **Step 4: 运行完整测试与构建**

Run: `pnpm test && pnpm build`

Expected: 所有测试和 Vite 构建均成功。

- [ ] **Step 5: 检查变更与提交**

Run: `git status --short`

Expected: 只包含本功能相关文件；若工作区为 Git 仓库，提交信息为 `feat: let model direct controlled tool calls`。
