# Financial Agent Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DeepSeek Agent Demo 建立可替换的真实金融数据工具层、可追溯对话上下文和三个金融工作台的首个可用版本。

**Architecture:** Node 服务端负责 Yahoo Finance、东方财富和 Binance 的公开市场数据适配、统一资产标识、缓存、工具调用审计和向 LLM 提供的数据快照；前端只消费规范化接口与工具记录。公开源仅用于开发与内测，生产替换为已授权供应商时不改变 Agent 或页面协议。

**Tech Stack:** React 19、Vite 7、Express 5、WebSocket、Node.js test runner、原生 `fetch`、DeepSeek 流式接口。

---

## 实施前置条件

- [ ] 不需要配置金融数据 API Key；服务端只允许访问固定的 Yahoo Finance、东方财富和 Binance 公开 API 域名。
- [ ] 确认公开源仅用于开发/内测，页面显示供应商、数据时间与延迟，不承诺实时、稳定性或再分发许可。

## 文件结构

- Create: `server/market/config.js` — 读取、校验和暴露供应商配置。
- Create: `server/market/symbols.js` — 统一资产标识与供应商代码映射。
- Create: `server/market/providers/*.js` — Yahoo Finance、东方财富和 Binance 适配器。
- Create: `server/market/gateway.js` — 参数校验、缓存、供应商选择、数据快照和审计元数据。
- Create: `server/tools/market.js` — 供 Agent 使用的受限工具定义与调用器。
- Modify: `server/index.js` — 注册只读市场数据 API 和 Agent 工具调用路由。
- Modify: `server/deepseek.js` — 将经过工具网关的结果注入模型消息并输出工具事件。
- Create: `src/lib/market.js` — 调用前端市场 API 与消费工具事件。
- Create: `src/components/FinancialWorkspace.jsx` — 三个工作台、资产上下文与数据状态。
- Create: `src/components/FinancialChat.jsx` — 全局金融对话、来源和工具调用记录。
- Modify: `src/App.jsx` — 在既有通用聊天与金融工作台之间加入入口，不破坏原会话功能。
- Modify: `src/styles.css` — 金融工作台、来源记录和移动端对话面板。
- Create: `tests/marketSymbols.test.js`、`tests/marketGateway.test.js`、`tests/marketTools.test.js`、`tests/financialUi.test.js`。

### Task 1: 建立供应商配置与资产标识

**Files:**
- Create: `server/market/config.js`
- Create: `server/market/symbols.js`
- Create: `tests/marketSymbols.test.js`

- [ ] **Step 1: 写失败测试**

测试 `600519.SH`、`0700.HK`、`AAPL.US` 和 `BTC/USDT` 分别映射为 A 股、港股、美股和加密资产；测试映射为 Yahoo Finance、东方财富或 Binance 的固定请求代码和市场标识。

- [ ] **Step 2: 运行 RED 验证**

Run: `pnpm test tests/marketSymbols.test.js`

Expected: FAIL，原因是资产解析与供应商配置模块尚不存在。

- [ ] **Step 3: 实现最小解析器与配置校验**

`normalizeSymbol(input)` 返回 `{ canonical, market, providerSymbol }`；`getMarketConfig()` 只暴露固定公共供应商的 `{ configured, provider, delay }`，不接受模型传入 URL、请求头或供应商名称。

- [ ] **Step 4: 运行 GREEN 验证**

Run: `pnpm test tests/marketSymbols.test.js`

Expected: PASS。

### Task 2: 实现只读市场数据网关

**Files:**
- Create: `server/market/providers/yahoo.js`
- Create: `server/market/providers/eastmoney.js`
- Create: `server/market/providers/binance.js`
- Create: `server/market/gateway.js`
- Create: `tests/marketGateway.test.js`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：网关为每个成功结果附加 `source`、`asOf`、`delay`、`symbol`、`confidence`；不支持的市场返回结构化 `provider_not_available`；缓存命中不重复请求供应商；供应商超时返回 `provider_unavailable`。

- [ ] **Step 2: 运行 RED 验证**

Run: `pnpm test tests/marketGateway.test.js`

Expected: FAIL，原因是网关与适配器尚不存在。

- [ ] **Step 3: 实现供应商适配器**

所有适配器只接受已规范化的代码并返回统一快照。Yahoo Finance 只访问固定 Chart API，东方财富只访问固定行情端点，Binance 只访问公开行情/衍生品端点；不支持的市场、速率限制、空数据、过期数据和 HTTP 失败统一映射为可展示错误。

- [ ] **Step 4: 实现网关缓存与审计元数据**

实时加密报价缓存 1-5 秒，K 线按周期缓存，财务和公告按披露版本缓存。审计记录只保存请求摘要、供应商、时间、耗时和结果状态，绝不保存 Key。

- [ ] **Step 5: 运行 GREEN 验证**

Run: `pnpm test tests/marketGateway.test.js`

Expected: PASS。

### Task 3: 让 Agent 受控调用金融工具

**Files:**
- Create: `server/tools/market.js`
- Modify: `server/deepseek.js`
- Create: `tests/marketTools.test.js`

- [ ] **Step 1: 写失败测试**

测试 Agent 只能调用白名单中的 `get_quote`、`get_candles`、`get_company_financials`、`search_market_news`、`get_crypto_derivatives`、`calculate_indicator` 和 `compare_assets`；测试工具异常被结构化传回，且没有结果时模型上下文不包含虚构价格。

- [ ] **Step 2: 运行 RED 验证**

Run: `pnpm test tests/marketTools.test.js`

Expected: FAIL，原因是金融工具白名单与上下文组装尚不存在。

- [ ] **Step 3: 实现工具注册与上下文快照**

工具调用必须通过 `gateway`，将工具名称、参数摘要、数据快照、来源、时间和错误状态传给模型。模型不能指定任意 URL、请求头、SQL 或代码；工具结果只读且不含凭据。

- [ ] **Step 4: 输出前端可消费的工具事件**

沿用现有 SSE 事件格式，新增 `tool` 和 `tool_result` 事件；前端可以展示“正在获取数据”和最终来源记录。

- [ ] **Step 5: 运行 GREEN 验证**

Run: `pnpm test tests/marketTools.test.js`

Expected: PASS。

### Task 4: 构建三工作台和全局金融对话

**Files:**
- Create: `src/lib/market.js`
- Create: `src/components/FinancialWorkspace.jsx`
- Create: `src/components/FinancialChat.jsx`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`
- Create: `tests/financialUi.test.js`

- [ ] **Step 1: 写失败测试**

测试金融界面有“行情研究”“事件投研”“交易员 Copilot”三个工作台和全局“金融对话”入口；测试发送提问时带上已选资产与当前工作台；测试回答渲染来源、数据时间、延迟和工具记录。

- [ ] **Step 2: 运行 RED 验证**

Run: `pnpm test tests/financialUi.test.js`

Expected: FAIL，原因是金融组件和市场客户端尚不存在。

- [ ] **Step 3: 实现工作台与对话入口**

桌面端使用工作区主内容与右侧对话面板；移动端将对话面板变为可展开区域。普通视图只显示结论、原因和风险；专业视图展开参数、指标、来源和调用详情。保持既有 `Enter` 发送、`Shift+Enter` 换行和输入法保护行为。

- [ ] **Step 4: 实现数据状态**

为加载、未配置供应商、限流、过期、空数据和供应商失败分别提供清晰文案；任何失败状态不得显示上一次价格为“当前实时数据”。

- [ ] **Step 5: 运行 GREEN 验证**

Run: `pnpm test tests/financialUi.test.js`

Expected: PASS。

### Task 5: 完整回归与真实源验收

**Files:**
- Test: `tests/*.test.js`
- Modify: `README.md`

- [ ] **Step 1: 补齐公开数据源文档**

在 README 标明 Yahoo Finance、东方财富和 Binance 的公开接口限制、授权边界、数据延迟、固定域名白名单与供应商替换方式。

- [ ] **Step 2: 运行完整测试与生产构建**

Run: `pnpm test && pnpm build`

Expected: 所有测试通过，Vite 构建成功。

- [ ] **Step 3: 使用公开接口做真实源烟雾测试**

Run: 对每种已配置市场发送一个 `get_quote` 请求。

Expected: 每个成功结果包含来源、数据时间和延迟；不支持、限流或失败的市场返回结构化状态，不伪造数据。

- [ ] **Step 4: 记录供应商边界**

在 README 记录每个供应商的市场覆盖、固定域名、延迟、公开接口限制与生产替换建议，避免前端将开发源误认为生产实时源。
