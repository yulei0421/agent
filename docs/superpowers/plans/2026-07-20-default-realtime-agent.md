# 默认实时数据 Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让天气、新闻和行情时效问题默认自动调用固定真实数据工具，并由 DeepSeek 基于工具结果总结。

**Architecture:** 在 `server/tools/live.js` 增加显式城市的固定地理编码能力；`server/deepseek.js` 不再把客户端联网开关作为实时工具前置条件，并为模型注入不可转嫁查询的实时工具约束。前端固定发送自动联网状态，并将原开关改为只读状态说明。

**Tech Stack:** Node.js、Express、React、SSE、Open-Meteo、Google News RSS、node:test。

---

### Task 1: 显式城市天气定位

**Files:**
- Modify: `server/tools/live.js`
- Test: `tests/liveContext.test.js`

- [ ] **Step 1: 写入失败测试**

在 `tests/liveContext.test.js` 添加测试：输入 `上海今天天气怎么样` 时，mock 请求必须先命中固定地理编码域名，随后 Open-Meteo URL 的 `latitude=31.23`、`longitude=121.47`、`timezone=Asia/Shanghai`，结果 `location` 为 `上海`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/liveContext.test.js`

Expected: 新测试失败，因为当前实现只通过 IPWho.is 确定地点。

- [ ] **Step 3: 实现最小城市解析与地理编码**

在 `server/tools/live.js`：

```js
const GEOCODING_ORIGIN = 'https://geocoding-api.open-meteo.com/v1/search';

export function extractRequestedCity(content) {
  const match = typeof content === 'string'
    ? content.match(/([\u4e00-\u9fff]{2,12})(?:市)?(?:今天|今日|当前|现在|实时|最新)?(?:的)?(?:天气|气温|降雨|台风|风力|湿度)/u)
    : null;
  return match?.[1] ?? null;
}
```

新增固定 URL 构建与响应校验函数；当 `extractRequestedCity` 有值时请求固定地理编码域名，否则保留 IPWho.is 回退逻辑。将两个定位结果标准化为 `{ city, latitude, longitude, timeZone }`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/liveContext.test.js`

Expected: 所有 live context 测试通过。

### Task 2: 默认实时工具编排与模型约束

**Files:**
- Modify: `server/deepseek.js`
- Test: `tests/webSearch.test.js`

- [ ] **Step 1: 写入失败测试**

在 `tests/webSearch.test.js` 添加两项测试：

```js
test('weather requests invoke get_weather without an explicit webSearch flag', async () => {
  // 不传 webSearch，断言首个 SSE 事件为 get_weather，且没有 search_web。
});

test('live tool context prohibits delegating supported lookups to users', async () => {
  // 断言提交给 DeepSeek 的 system message 包含“不得建议用户前往 App、网站或搜索引擎”。
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/webSearch.test.js`

Expected: 新测试失败，因为当前 `liveDataRequested` 依赖 `webSearch === true`。

- [ ] **Step 3: 实现默认编排**

在 `server/deepseek.js`：

```js
const liveDataRequested = isLiveDataRequest(query);
const automaticNewsRequested = isLiveDataRequest(query) && !weatherRequested;
```

新增受控新闻意图（新闻、消息、报道、资讯、公告、研报），将新闻工具分支改为 `isNewsRequest(query) || req.body?.webSearch === true`。单独出现“今天”只获取日期上下文、不查询新闻；天气、新闻和行情工具优先执行。在 `liveContextMessage` 与 `webSearchContext` 的系统消息追加“已支持的实时查询必须基于工具结果回答，不能建议用户自行前往 App、网站或搜索引擎查询”。保留工具失败 SSE，不创建兜底虚假数据。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/webSearch.test.js`

Expected: 所有 web search 测试通过。

### Task 3: 自动联网状态与来源 UI

**Files:**
- Modify: `src/components/ChatWindow.jsx`
- Modify: `src/App.jsx`
- Modify: `tests/webSearch.test.js`
- Modify: `README.md`

- [ ] **Step 1: 写入失败测试**

更新 UI 源码契约测试，断言：

```js
assert.match(windowSource, /自动联网/);
assert.doesNotMatch(windowSource, /useState\(false\)/);
assert.match(appSource, /streamChat\(payload, abortRef\.current\.signal,[\s\S]*\{ webSearch: true \}\)/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/webSearch.test.js`

Expected: 新测试失败，因为 UI 仍展示可关闭的“联网搜索”开关。

- [ ] **Step 3: 实现最小 UI 与文档更新**

移除 `ChatWindow` 的 `webSearch` state 和 checkbox，使用静态说明“自动联网：时效问题将调用固定数据源”；在 `App.jsx` 调用 `streamChat` 时传入 `{ webSearch: true }`，以兼容非时效的一般新闻主动搜索。将 README 的“显式开启”文案改为默认自动调用、白名单来源和 IP 回退定位说明。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/webSearch.test.js`

Expected: 所有 UI 与后端 SSE 契约测试通过。

### Task 4: 全量验证

**Files:**
- Verify: `tests/liveContext.test.js`
- Verify: `tests/webSearch.test.js`
- Verify: production build

- [ ] **Step 1: 运行全量测试**

Run: `pnpm test`

Expected: 所有测试通过。

- [ ] **Step 2: 构建生产产物**

Run: `pnpm build`

Expected: Vite 构建成功。

- [ ] **Step 3: 真实接口验证**

Run: `pnpm dev`，输入“上海今天天气怎么样”。

Expected: 页面显示 `get_weather`、上海、Open-Meteo、服务器时间、观测时间及秒级时差；DeepSeek 基于工具数据总结，未建议用户改用 App 或网站。

## 自检

- 设计的五项验收标准分别覆盖在任务 1 至 4 中。
- 本计划没有未完成项目，函数名与测试目标保持一致。
- 仅新增受控地理编码，不扩大为任意网页访问。
