# 实时上下文与天气工具实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户显式开启联网搜索时，Agent 能识别时效问题、按请求 IP 的地区确定“今天”，并为天气问题调用真实天气数据。

**Architecture:** 新增独立的实时上下文工具，使用固定的 IP 地理定位和 Open-Meteo 端点；服务端仅在联网开关已开启且意图为时效信息时调用。聊天流先发出可审计的 SSE 工具事件，再把当前日期、时区、地点和未验证的工具数据作为系统上下文交给模型；UI 沿用现有工具记录区域展示天气来源与观测时间。

**Tech Stack:** Node.js、Express、原生 `fetch`、SSE、React、Node Test。

---

### Task 1: 实时意图与时区上下文

**Files:**
- Create: `server/tools/live.js`
- Test: `tests/liveContext.test.js`

- [ ] **Step 1: 编写失败测试，定义时效意图和时区日期的公开接口**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { isLiveDataRequest, formatLocalDate } from '../server/tools/live.js';

test('isLiveDataRequest only recognises explicit current-information intent', () => {
  assert.equal(isLiveDataRequest('今天北京天气如何'), true);
  assert.equal(isLiveDataRequest('AAPL 最新价格'), true);
  assert.equal(isLiveDataRequest('解释什么是债券'), false);
});

test('formatLocalDate renders today in the supplied IANA timezone', () => {
  assert.equal(formatLocalDate(new Date('2026-07-20T00:30:00.000Z'), 'Asia/Shanghai'), '2026-07-20');
  assert.equal(formatLocalDate(new Date('2026-07-20T00:30:00.000Z'), 'America/Los_Angeles'), '2026-07-19');
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在失败**

Run: `node --test tests/liveContext.test.js`

Expected: FAIL，报 `ERR_MODULE_NOT_FOUND`，因为 `server/tools/live.js` 尚不存在。

- [ ] **Step 3: 用最小实现识别时效意图并格式化 IANA 时区日期**

```js
const LIVE_INTENT = /(天气|气温|降雨|台风|今天|今日|当前|现在|实时|最新)/u;

export function isLiveDataRequest(content) {
  return typeof content === 'string' && LIVE_INTENT.test(content);
}

export function formatLocalDate(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test tests/liveContext.test.js`

Expected: PASS，2 个测试均通过。

### Task 2: 固定端点的 IP 定位和天气查询

**Files:**
- Modify: `server/tools/live.js`
- Modify: `tests/liveContext.test.js`

- [ ] **Step 1: 编写失败测试，约束固定来源、字段白名单和错误码**

```js
import { buildWeatherUrl, resolveLiveContext } from '../server/tools/live.js';

test('resolveLiveContext only calls fixed geo and weather origins and normalizes the weather snapshot', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(new URL(url));
    if (url.includes('ipwho.is')) return jsonResponse({ success: true, city: 'Shanghai', latitude: 31.23, longitude: 121.47, timezone: { id: 'Asia/Shanghai' } });
    return jsonResponse({ current: { time: '2026-07-20T09:00', temperature_2m: 31.2, apparent_temperature: 35, weather_code: 2, wind_speed_10m: 12 } });
  };

  const result = await resolveLiveContext({ ip: '203.0.113.10', content: '今天天气', fetchImpl, now: () => new Date('2026-07-20T01:00:00.000Z') });
  assert.deepEqual(seen.map((url) => url.origin), ['https://ipwho.is', 'https://api.open-meteo.com']);
  assert.equal(result.weather.city, 'Shanghai');
  assert.equal(result.date, '2026-07-20');
});

test('buildWeatherUrl keeps coordinates in query parameters on the fixed Open-Meteo endpoint', () => {
  const url = new URL(buildWeatherUrl(31.23, 121.47, 'Asia/Shanghai'));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '31.23');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Shanghai');
});
```

- [ ] **Step 2: 运行测试并确认因接口缺失失败**

Run: `node --test tests/liveContext.test.js`

Expected: FAIL，导入 `buildWeatherUrl` 或 `resolveLiveContext` 失败。

- [ ] **Step 3: 实现限时、无重定向的 IP 地理定位与天气工具**

```js
const GEO_ORIGIN = 'https://ipwho.is';
const WEATHER_ORIGIN = 'https://api.open-meteo.com/v1/forecast';

export function buildWeatherUrl(latitude, longitude, timeZone) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: timeZone,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m'
  });
  return `${WEATHER_ORIGIN}?${params}`;
}

export async function resolveLiveContext({ ip, content, fetchImpl = fetch, now = () => new Date() }) {
  // 只接受普通 IP 字符，避免将请求头内容变成路径或 URL。
  if (!isLiveDataRequest(content) || !isSafeIp(ip)) return { ok: true, date: formatLocalDate(now(), 'Asia/Shanghai') };
  const location = await fetchJson(fetchImpl, `${GEO_ORIGIN}/${encodeURIComponent(ip)}`);
  const timeZone = validTimeZone(location.timezone?.id) ? location.timezone.id : 'Asia/Shanghai';
  const date = formatLocalDate(now(), timeZone);
  if (!isWeatherRequest(content)) return { ok: true, date, timeZone, location: location.city };
  const snapshot = await fetchJson(fetchImpl, buildWeatherUrl(location.latitude, location.longitude, timeZone));
  return { ok: true, date, timeZone, weather: normalizeWeather(location, snapshot.current) };
}
```

- [ ] **Step 4: 补充定位失败、无效 IP、无效响应和超时测试**

```js
test('resolveLiveContext never calls a provider for an unsafe IP and returns a structured provider error', async () => {
  let calls = 0;
  const result = await resolveLiveContext({ ip: '127.0.0.1,evil', content: '今天天气', fetchImpl: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.deepEqual(result, { ok: false, errorCode: 'invalid_client_ip' });
});
```

- [ ] **Step 5: 运行测试并确认通过**

Run: `node --test tests/liveContext.test.js`

Expected: PASS，固定源、日期语义、失败安全性全部通过。

### Task 3: 流式对话编排与可审计事件

**Files:**
- Modify: `server/deepseek.js`
- Modify: `server/index.js`
- Modify: `tests/webSearch.test.js`

- [ ] **Step 1: 编写失败测试，确认仅在联网开关开启且意图具备时调用实时工具**

```js
test('enabled weather request emits get_weather before the LLM request and injects its local date context', async () => {
  const res = createSseResponse();
  let upstreamBody;
  globalThis.fetch = async (_, options) => { upstreamBody = JSON.parse(options.body); return completedUpstream(); };
  await streamDeepSeek({ ip: '203.0.113.10', body: { webSearch: true, messages: [{ role: 'user', content: '今天天气' }] } }, res, {
    liveContext: async () => ({ ok: true, date: '2026-07-20', timeZone: 'Asia/Shanghai', weather: { city: 'Shanghai', observedAt: '2026-07-20T09:00:00+08:00', temperatureC: 31.2, apparentTemperatureC: 35, weatherCode: 2, windSpeedKph: 12, source: 'open-meteo' } })
  });
  assert.match(res.writes[0], /"name":"get_weather"/);
  assert.match(res.writes[1], /"name":"get_weather"/);
  assert.match(upstreamBody.messages[0].content, /2026-07-20/);
});
```

- [ ] **Step 2: 运行测试并确认因缺少实时工具事件失败**

Run: `node --test tests/webSearch.test.js`

Expected: FAIL，`get_weather` 事件未出现。

- [ ] **Step 3: 注入实时上下文，并只对非天气时效问题补充带日期的新闻查询**

```js
if (req.body?.webSearch === true && isLiveDataRequest(query)) {
  const live = await liveContext({ ip: getClientIp(req), content: query });
  toolContextMessages.push(liveContextMessage(live));
  if (live.weather) {
    res.write(formatSse({ type: 'tool', name: 'get_weather', location: live.weather.city }));
    res.write(formatSse({ type: 'tool_result', name: 'get_weather', status: 'success', ...live.weather }));
  }
}
if (req.body?.webSearch === true && !isWeatherRequest(query)) {
  const datedQuery = live?.date ? `${query} ${live.date}` : query;
  // 继续使用既有固定 Google News RSS 搜索。
}
```

- [ ] **Step 4: 在 Express 中配置受控代理信任并传入真实请求对象**

```js
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.post('/api/chat/stream', (req, res) => streamDeepSeek(req, res, { marketGateway }));
```

- [ ] **Step 5: 运行聊天测试并确认通过**

Run: `node --test tests/webSearch.test.js`

Expected: PASS，既有新闻搜索行为不回归，天气的工具调用、日期上下文和关闭开关行为均通过。

### Task 4: 对话记录呈现与使用说明

**Files:**
- Modify: `src/components/MessageItem.jsx`
- Modify: `src/styles.css`
- Modify: `README.md`
- Modify: `tests/webSearch.test.js`

- [ ] **Step 1: 编写失败测试，约束天气工具记录的用户可见字段**

```js
assert.match(itemSource, /event\.name === 'get_weather'/);
assert.match(itemSource, /event\.city/);
assert.match(itemSource, /event\.observedAt/);
assert.match(itemSource, /event\.temperatureC/);
assert.match(itemSource, /event\.source/);
```

- [ ] **Step 2: 运行测试并确认因尚未渲染天气来源失败**

Run: `node --test tests/webSearch.test.js`

Expected: FAIL，源码不含 `get_weather` 渲染分支。

- [ ] **Step 3: 在既有工具记录中增加天气成功与失败展示**

```jsx
) : event.name === 'get_weather' && event.status === 'success' ? (
  <section className="live-weather" aria-label="实时天气来源">
    <h4>实时天气</h4>
    <p>{event.city} · {event.temperatureC}°C，体感 {event.apparentTemperatureC}°C</p>
    <span>观测 {event.observedAt} · 来源 {event.source}</span>
  </section>
) : event.name === 'get_weather' ? (
  <span aria-label="实时天气错误">{event.errorCode ?? 'unknown_error'}</span>
)
```

- [ ] **Step 4: 为天气记录添加与当前来源列表一致的紧凑样式，并更新隐私/来源说明**

```css
.live-weather {
  display: grid;
  gap: 4px;
}
```

README 须说明：仅当用户开启联网搜索且提出时效问题时，服务端会把请求 IP 发送给固定地理定位服务；定位用于选择天气地点与日期语义，不持久化 IP。

- [ ] **Step 5: 运行前端与聊天测试并确认通过**

Run: `node --test tests/webSearch.test.js`

Expected: PASS，天气记录的字段、可访问性标签和原新闻来源展示均被覆盖。

### Task 5: 全量验证

**Files:**
- Verify: `tests/liveContext.test.js`
- Verify: `tests/webSearch.test.js`
- Verify: `package.json`

- [ ] **Step 1: 运行完整单元测试**

Run: `pnpm test`

Expected: PASS，所有测试通过且无失败。

- [ ] **Step 2: 运行生产构建**

Run: `pnpm build`

Expected: exit code 0，Vite 成功生成 `dist/`。

- [ ] **Step 3: 使用本地服务进行可见验证**

Run: `pnpm dev`

Expected: 开启“联网搜索”后发送“今天天气如何”，依次显示 `get_weather` 调用、城市和观测时间；发送“今天平安银行新闻”时显示以真实本地日期检索的 `search_web` 调用；关闭开关后两类查询都不调用联网工具。
