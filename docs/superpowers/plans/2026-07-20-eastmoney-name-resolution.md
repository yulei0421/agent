# 东方财富中文名称行情 Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持 A 股中文名称、标准代码和常见指数名称的自动行情查询，并让 DeepSeek 基于固定东方财富数据源总结。

**Architecture:** 在现有 `market/search.js` 中暴露受控的东方财富候选解析能力；新增名称实体解析器，将自然语言解析出的代码交给现有行情网关。中国市场报价改为东方财富主源、腾讯降级，Agent 通过 SSE 输出解析后的工具记录并注入不可转嫁查询的模型约束。

**Tech Stack:** Node.js、Express、React、SSE、东方财富公开接口、腾讯财经降级、node:test。

---

### Task 1: 中文名称与指数代码解析

**Files:**
- Modify: `server/market/search.js`
- Modify: `server/tools/market.js`
- Test: `tests/assetSearch.test.js`
- Test: `tests/marketTools.test.js`

- [ ] **Step 1: 写失败测试**

```js
test('resolves a Chinese A-share name through the fixed Eastmoney suggest endpoint', async () => {
  // “贵州茅台”解析为 { symbol: '600519.SH', name: '贵州茅台', market: 'cn' }。
});

test('extracts Chinese market names and the Shanghai Composite alias from a chat query', async () => {
  // “贵州茅台和上证指数最新行情”解析为 600519.SH、000001.SH。
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/assetSearch.test.js tests/marketTools.test.js`

Expected: 新测试失败，因为当前工具只从正则提取显式代码。

- [ ] **Step 3: 实现最小解析器**

在 `search.js` 导出一个仅使用固定东方财富 suggest URL 的 `resolveChineseAssetName(query, fetchImpl)`；只接受经 `normalizeSymbol` 验证的沪深证券或指数代码。`market.js` 新增异步 `resolveMarketSymbols(query, resolver)`：先保留显式代码，再匹配受控指数别名与中文候选，最多返回三个 `{ symbol, name }`。

- [ ] **Step 4: 运行通过测试**

Run: `node --test tests/assetSearch.test.js tests/marketTools.test.js`

Expected: 解析中文名、指数别名及既有显式代码的测试全部通过。

### Task 2: 东方财富主报价与腾讯降级

**Files:**
- Modify: `server/market/gateway.js`
- Modify: `server/market/config.js`
- Test: `tests/marketGateway.test.js`

- [ ] **Step 1: 写失败测试**

```js
test('uses Eastmoney as the primary CN quote source and Tencent after an Eastmoney failure', async () => {
  // 第一次请求固定东方财富报价 URL 失败，第二次请求固定腾讯 URL，并返回腾讯规范化快照。
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/marketGateway.test.js`

Expected: 新测试失败，因为当前中国市场配置只选择腾讯。

- [ ] **Step 3: 实现报价提供方链路**

中国市场配置提供 `providers: ['eastmoney', 'tencent']`。网关按顺序请求：东方财富响应有效即返回；仅当可恢复的上游错误发生时调用腾讯。返回 `meta.source` 为实际提供方，不将失败的东方财富价格带入降级结果。

- [ ] **Step 4: 运行通过测试**

Run: `node --test tests/marketGateway.test.js`

Expected: 中国市场主源、降级、限流和既有其他市场测试全部通过。

### Task 3: Agent 工具编排与不可转嫁约束

**Files:**
- Modify: `server/deepseek.js`
- Modify: `server/tools/market.js`
- Test: `tests/marketTools.test.js`

- [ ] **Step 1: 写失败测试**

```js
test('Chinese market queries emit resolved quote tool events and prohibit handing the lookup to users', async () => {
  // “贵州茅台最新行情”触发 get_quote，断言传给 DeepSeek 的 system message 包含“不得建议用户前往财经网站、交易软件或搜索引擎”。
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/marketTools.test.js`

Expected: 新测试失败，因为 `streamDeepSeek` 当前只通过同步代码正则产生工具事件。

- [ ] **Step 3: 实现 Agent 路由**

将 `streamDeepSeek` 的行情解析改为等待名称解析器结果，并把解析名称与标准代码写入 `get_quote` SSE 事件。成功上下文包含来源、快照时间和延迟；失败上下文同时限制模型不得把已支持行情查询转嫁给用户。

- [ ] **Step 4: 运行通过测试**

Run: `node --test tests/marketTools.test.js`

Expected: 中文名、指数、显式代码、工具失败与模型约束测试全部通过。

### Task 4: 端到端验证与文档

**Files:**
- Modify: `README.md`
- Verify: `tests/*.test.js`

- [ ] **Step 1: 更新说明**

在 README 标明：A 股中文名称通过东方财富联想接口解析，报价优先东方财富并可降级腾讯；公开接口仅用于开发/内测，页面显示来源和时效。

- [ ] **Step 2: 全量自动化验证**

Run: `pnpm test && pnpm build`

Expected: 所有测试通过且 Vite 构建成功。

- [ ] **Step 3: 真实接口验证**

向 `/api/chat/stream` 发送“贵州茅台最新行情”和“上证指数现在多少”，确认 SSE 先出现 `get_quote` 工具事件，再出现包含实际来源与价格的成功结果；确认 DeepSeek 总结不建议用户自行访问财经网站或交易软件。

## 自检

- 中文 A 股名称、代码和指数别名分别由任务 1 覆盖。
- 主数据源与降级由任务 2 覆盖。
- Agent 编排、来源与失败约束由任务 3 覆盖。
- 真实数据、测试、构建和授权说明由任务 4 覆盖。
