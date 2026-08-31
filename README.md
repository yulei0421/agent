# DeepSeek 金融 AI Agent Demo

一个用于学习和验证 AI Agent 工程模式的金融研究 Demo。项目以 React 金融工作台为界面，通过 NestJS 服务调用 DeepSeek 兼容 API，并把天气、新闻、资产搜索、市场报价、固定窗口技术指标和经济日历统一为模型可选择的受控工具。

它关注的是流式对话、工具调用、外部数据边界和本地会话体验，而不是交易执行系统。所有市场信息均应在工具查询后才进入对话或研究结果。

## 项目概览

| 层级 | 技术 | 职责 |
| --- | --- | --- |
| 前端 | React 19 + Vite 7 | 对话、金融工作台、资产选择和工具结果展示。 |
| 本地数据 | IndexedDB | 保存本地用户、会话（含有限工作记忆）、消息和离线待重试队列。 |
| 实时通信 | SSE + WebSocket | 流式回答与工具事件；连接状态、心跳和重连。 |
| 服务端 | Node.js + NestJS 11 | 分层 API、SSE、WebSocket、模型适配、受控工具与资产搜索。 |
| Agent 能力 | CapabilityManifest + ToolManifest | 部署期固定发布工具、子 Agent 和模型槽位；模型和 HTTP 输入均不能动态注册能力。 |
| 研究导出 | PDFKit + PptxGenJS | 将已校验的金融研究报告同步导出为 PDF 或可编辑 PPTX。 |
| 文档处理 | PDF.js + Tesseract.js + @napi-rs/canvas | 提取 PDF 文本层，并对扫描 PDF、PNG/JPG/WEBP 图片执行 OCR。 |
| 市场数据 | 东方财富、腾讯、Yahoo Finance、Binance | 分市场获取报价，并附带来源、时间和延迟元数据。 |

## 核心功能

### 对话与会话

- DeepSeek 响应通过 SSE 增量渲染；服务端每 15 秒发送不进入业务事件流的 keep-alive 注释帧，生成中可中止，错误会显示在会话中。
- 被停止或失败的助手回答支持“重新生成”，会基于最近一条用户消息发起新的本地会话请求，原记录不会被覆盖。
- 本地用户名、会话和消息存储在浏览器 IndexedDB，不需要账户服务。
- 离线发送的消息会进入本地队列；浏览器重新联网后自动重试。
- 助手回答支持 Markdown，并可展示工具调用状态、天气、新闻、资产和报价结果。
- 侧栏会读取服务端公开能力清单，展示当前可用的工具、研究角色和模型槽位；只展示名称、类别和描述，不暴露执行器或密钥。
- 可附加 TXT、MD、CSV、JSON、PDF 或 PNG/JPG/WEBP 图片；文本文件在浏览器本地读取，PDF/图片以不超过 8 MB 的 base64 请求交给服务端提取文本（PDF 文本层优先，扫描 PDF 和图片使用 OCR），原始文件不会写入磁盘。
- 已完成对话会在当前浏览器会话中保留不超过 1200 个字符的工作记忆；它只是参考上下文，不是新的系统指令，也不会上传到服务端持久化。
- 文档摘要以 `{name, mimeType, text}` 发送并在服务端二次校验；二进制文档通过 `POST /api/documents/ingest` 提取为受限文本后再进入聊天，不接受 URL/IP 内容或独立文件存储。

### 金融研究工作台

- 提供「行情研究、事件投研、交易员 Copilot、自选、预警」五个研究页签。
- 行情研究页可在 `AAPL`、`0700.HK`、`600519.SH`、`BTC/USDT` 间切换，也可以通过顶部资产搜索选择更多资产。
- 所选页签和资产会作为受校验的服务端上下文传给模型，帮助它选择合适的查询工具。
- 事件、自选和预警等页签目前是研究入口或未配置状态，不会展示未经工具查询的市场结论；交易员 Copilot 仅研究，不执行下单。

### 资产搜索与行情

- 输入至少 3 个字符后，前端以 250 ms 防抖请求资产搜索；新的输入会取消之前的请求。
- 支持中国股票、港股、美股和加密货币代码的规范化，例如 `600519.SH`、`0700.HK`、`AAPL` / `AAPL.US`、`BTC/USDT`。
- 行情网关会校验代码和允许的数据源，为请求设置超时，短时缓存结果并合并相同的并发请求。
- 报价结果携带价格、涨跌幅、币种、来源、观测时间、抓取时间、数据年龄与延迟状态；数据源异常不会被伪装为实时行情。
- 技术指标工具只从允许的市场网关获取固定的日线/月窗口，并在服务端计算 `SMA14` 与 `RSI14`；模型不能指定指标公式、时间窗口或上游地址。
- 经济日历工具只读取固定的公开周度日历源，输出经过校验的时间、国家、标题、影响等级和实际/预测/前值字段。

### 模型工具

模型可以自行决定是否调用以下六个部署期固定的 `read_only` ToolManifest；浏览器不能直接执行、注册或关闭工具。每个 manifest 同时固化版本、风险等级、闭合 schema、10 秒执行时限和执行器。

| 工具 | 用途 | 输入 |
| --- | --- | --- |
| `get_weather` | 查询指定城市或当前所在地的天气 | 可选 `city` |
| `search_news` | 检索近期新闻和报道 | 必填 `query` |
| `search_asset` | 按名称或代码查找可查询金融资产 | 必填 `query` |
| `get_quote` | 查询已确认市场代码的报价与时间 | 必填 `symbol` |
| `get_technical_indicators` | 基于固定日线/月窗口计算 `SMA14` 与 `RSI14` | 必填 `symbol` |
| `get_economic_calendar` | 查询固定公开源提供的本周宏观经济日历 | 无参数 |

## 界面与使用流程

1. 首次打开时填写本地显示名称；信息只写入当前浏览器的 IndexedDB。
2. 创建会话并输入问题。需要市场上下文时，先打开金融工作台并选择资产，或在顶部搜索框中选择资产。
3. 前端把精简后的会话历史、有限本地工作记忆和按问题召回的附件片段发送至服务端。服务端附加系统策略和当前金融上下文，再以流式方式请求 DeepSeek。
4. LangGraph 先生成仅服务端可见的短计划；模型若提出工具调用，服务端用同一份 ToolManifest 校验名称和参数、限时执行。同一轮合法调用并行启动，但 SSE 事件和回传模型的结果严格保持模型原始顺序。
5. LangGraph 会将已裁剪的计划快照通过 SSE 返回；对话区域显示待执行、执行中和已完成步骤。回答完成后会把最后一次计划快照保存到当前浏览器会话。
6. 对话区域依次显示推理提示、回答增量、工具调用和工具结果；回答完成后会保存到本地会话。
7. 可选备用模型只在主模型产生任何可见事件前失败时启用；流中途失败不会拼接第二个回答，取消请求也不会切换。切换次数只写入进程内 Prometheus 指标。
8. 金融研究模式会并行启动“研究员”和“风险复核员”两个受限子 Agent；它们只返回数据需求和风险检查清单，不执行工具、不输出事实，主 Agent 再统一调用工具并生成报告。
9. 普通聊天、复杂研究和结构化研究可分别路由到 `fast`、`reasoning`、`structured` 模型槽位；未配置专用槽位时回退默认模型。
10. 每个聊天请求都会获得一个进程内临时任务 ID，可查询或取消；任务默认保留 10 分钟，服务重启、连接断开或过期后不可恢复。

## 系统架构

```text
┌──────────────────────────────── Browser ────────────────────────────────┐
│ React UI                                                                  │
│  ├─ 对话、Markdown 与工具结果卡片                                         │
│  ├─ 金融工作台与资产搜索                                                   │
│  ├─ IndexedDB: users / sessions(memory) / messages / offlineQueue        │
│  └─ SSE、HTTP、WebSocket 客户端                                            │
└───────────────┬───────────────────────────┬──────────────────────────────┘
                │ /api/chat/stream (SSE)    │ /api/market/search, /ws
                v                           v
┌──────────────────────────── NestJS 服务端 ──────────────────────────────┐
│ API：HTTP、SSE、WebSocket、CORS 与连接取消                               │
│   -> CapabilityRegistry / TaskRuntime：能力发现、任务状态与取消             │
│   -> Application：Chat / Market 用例                                     │
│   -> Domain：消息、工具端口、错误合同                                     │
│   -> Infrastructure：DeepSeek、工具注册表、市场供应商                    │
│                                                                            │
│  LangGraph 在线 Agent ──> 工具注册表 ──> 天气 / 新闻 / 资产 / 行情 / 指标 / 日历│
│                                      │                  │                │
│                                      │                  └─ 市场数据供应商│
│                                      └─ 字段清洗、调用上限与错误归一化    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                v
                     DeepSeek 兼容 Chat Completions API
```

`server/agent/` 使用 LangGraph 运行在线 Agent：模型根据受控工具清单决定是否调用工具，服务端校验并执行后把结果回传模型，直到输出最终回答或达到安全上限。

## 请求与数据流

### 流式聊天

```text
React -> POST /api/chat/stream -> Nest API -> TaskRuntime -> ChatApplicationService -> AgentRunner -> LangGraph -> DeepSeek
      <- SSE task / delta / reasoning / tool / tool_result / error / done
```

1. 服务端只接收 `user` 与 `assistant` 角色的非空文本消息，并限制单条内容长度；可选文档摘要必须匹配服务端的文本 MIME、文件名和字符数契约。浏览器在请求前会对当前会话附件做有限分片召回，服务端仍对召回结果二次校验。
2. 若前端处于金融工作台，`context.financial` 必须同时包含允许的页签和合法资产代码；不合法上下文会被忽略。
3. Planner 生成至多三步的内部计划；当前步骤仅作为服务端拥有的模型指令参与下一次决策，不会写入 SSE、浏览器历史或日志。
4. 服务端注入自身系统策略和“工具输出不可信”的保护指令，再按固定任务类型路由到模型槽位并发起流式请求。每轮调用都按不可变 ToolManifest 的闭合 schema 校验，并受单工具时限和子 `AbortSignal` 保护。
5. 同轮合法工具调用并行执行以缩短研究延迟；其 `tool`、`tool_result` SSE 事件及后续模型消息仍按模型原始调用顺序输出。任一取消结果都会终止当前请求，任务状态同步标记为 `cancelled`。
6. 每轮结束后，图只向下一次模型请求提供服务端派生的调用数、失败数、陈旧数、结果类别和新鲜度摘要，不包含原始工具内容。连续两轮全部失败、陈旧数据无法继续推进、达到 3 轮或 6 次调用上限时，工具被禁用并要求模型直接作答。
7. 浏览器端会把已完成的最近对话压缩为最多 1200 个字符的工作记忆，并按当前问题从历史文本附件中召回最多四个有界文档片段；两者均标记为参考上下文，不改变服务端系统策略。

### 金融研究 JSON 报告

金融工作台在金融上下文通过服务端校验时，会请求 `financial_research` 输出模式，并自动选择 `structured` 模型槽位（如果已配置）。服务端才会添加不可由客户端伪造的 JSON 契约：标题、结论、至多六项证据、至多六项风险，以及可选 ISO 数据时间；普通聊天不会强制 JSON。

浏览器仅接受普通对象原型、字段长度、数组上限和时间格式均合格的报告，未知字段会被丢弃。合格报告显示为“结论 / 依据 / 风险 / 数据时间”卡片；格式不合法时保留原始 Markdown，工具结果仍独立展示。

### 资产搜索

```text
React 搜索框 -> GET /api/market/search?q=<query> -> 资产搜索服务 -> JSON results
```

查询参数 `q` 长度必须为 1 到 64 个字符。客户端断开或取消请求时，服务端会取消下游搜索并停止写入响应；前端把这类取消视为正常中止，而不是搜索失败。

### 连接状态

```text
React <-> WebSocket /ws <-> Nest HTTP server
```

连接建立后服务端发送 `status: connected`。客户端每 5 秒发送 `ping`，服务端回复 `pong`，并每 15 秒广播一次 `notice` 心跳；连接关闭后客户端会在约 1.2 秒后尝试重连。

## 本地运行

### 前置条件

- Node.js：建议使用与当前依赖兼容的 LTS 版本。
- pnpm：用于安装依赖和运行脚本。
- DeepSeek API Key：用于流式聊天；未配置时 `/api/chat/stream` 会返回明确错误。

### 安装与配置

```bash
pnpm install
cp .env.example .env
```

编辑本地 `.env`，至少填写：

```env
DEEPSEEK_API_KEY=在这里填写你的apikey
```

`.env` 已被 Git 忽略。不要将 API Key 写入 README、源代码、Issue、提交信息或截图；分享配置时请使用 `.env.example`。

### 启动

```bash
pnpm dev
```

该命令同时启动 Vite 前端与 Node 服务。默认情况下，前端地址为 `http://127.0.0.1:5173`，Node 服务为 `http://127.0.0.1:8787`。

也可以分别启动：

```bash
pnpm server
pnpm client
```

若出现 `EADDRINUSE`，表示端口已被旧进程占用。停止旧进程，或修改 `.env` 中的 `PORT` 后重试。

## 配置项

| 配置项 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | 无 | DeepSeek API Key，仅保留在本地 `.env`。 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | DeepSeek 兼容 API 服务地址。 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-v4-flash` | 请求使用的模型名称；需为账户已开通的模型。 |
| `MODEL_TOTAL_TIMEOUT_MS` | 否 | `60000` | 一次模型调用的总时限，范围为 100 至 120000 毫秒。 |
| `MODEL_FIRST_EVENT_TIMEOUT_MS` | 否 | `15000` | 等待第一个模型事件的时限，范围为 100 至 120000 毫秒。 |
| `MODEL_IDLE_TIMEOUT_MS` | 否 | `30000` | 相邻模型事件之间的最大空闲时间，范围为 100 至 120000 毫秒。 |
| `MODEL_MAX_RETRIES` | 否 | `1` | 首个模型事件前、可恢复失败时的最大重试次数，只能是 0 或 1。 |
| `MODEL_CIRCUIT_FAILURE_THRESHOLD` | 否 | `3` | 打开模型熔断器前的连续可恢复失败次数，范围为 1 至 20。 |
| `MODEL_CIRCUIT_COOLDOWN_MS` | 否 | `30000` | 熔断器开放后的冷却时间，范围为 100 至 120000 毫秒。 |
| `PORT` | 否 | `8787` | 本地 Node 服务端口。 |
| `CLIENT_URL` | 否 | `http://127.0.0.1:5173` | 允许访问服务端的前端源；前端端口变化时需同步修改。 |
| `TRUST_PROXY` | 否 | `false` | 仅在恰好一层受信任反向代理转发客户端 IP 时设为 `true`。 |
| `BINANCE_REST_BASE_URL` | 否 | `https://api.binance.com` | 开发和演示环境的 Binance REST 数据源地址。 |
| `PDF_CJK_FONT_PATH` | 否 | macOS Unicode 字体路径 | 部署环境中用于 PDF 中文嵌入的绝对字体路径；Linux 生产环境应配置已授权的 CJK TrueType/OpenType 字体。 |
| `OCR_LANGUAGE` | 否 | `chi_sim+eng` | Tesseract OCR 语言组合。 |
| `TESSERACT_LANG_PATH` / `TESSERACT_WORKER_PATH` / `TESSERACT_CORE_PATH` | 否 | Tesseract 默认资源 | Tesseract 语言数据、Worker 和 WASM 核心的绝对路径；默认语言数据从 Tesseract CDN 加载，离线或生产环境建议配置本地资源路径。 |

## 服务接口与事件

| 方法与路径 | 用途 | 返回 |
| --- | --- | --- |
| `GET /api/health` | 存活检查 | `{ "status": "ok" }` |
| `GET /api/ready` | 就绪检查 | 模型已配置且熔断器关闭时返回 200；否则返回 503 和公开状态。 |
| `GET /api/metrics` | Prometheus 进程指标 | `text/plain; version=0.0.4`；仅聚合请求、耗时、熔断与断连数据。 |
| `GET /api/capabilities` | 获取服务端固定能力摘要 | `{ "capabilities": [...] }` |
| `GET /api/tasks/:id` | 获取进程内任务状态摘要 | 固定状态、计数和时间字段；不存在或过期返回 `404` |
| `POST /api/tasks/:id/cancel` | 取消进程内任务 | 取消后的任务摘要；重复取消幂等 |
| `GET /api/market/search?q=<query>` | 按名称或代码搜索资产 | `{ "results": [...] }` |
| `POST /api/chat/stream` | 提交会话并取得 DeepSeek 流式回答 | `text/event-stream` |
| `POST /api/approvals/:id/:decision` | 批准或拒绝当前 SSE 请求等待中的工具调用 | `{ "approvalId": "...", "decision": "approved" }` |
| `POST /api/exports/research/pdf` | 将已校验研究报告导出为 PDF | `application/pdf` 附件 |
| `POST /api/exports/research/pptx` | 将已校验研究报告导出为可编辑 PPTX | PPTX 附件 |
| `POST /api/exports/research/:format/link` | 服务端生成报告并创建短期下载链接 | `{ "downloadUrl": "...", "filename": "...", "expiresAt": "..." }` |
| `GET /api/exports/research/download/:token` | 下载已生成的 PDF/PPTX 文件 | 对应文件附件；链接过期后返回 `404` |
| `POST /api/documents/ingest` | 提取 PDF/图片中的文本并返回受限文档摘要 | `{ "document": { "name", "mimeType", "text", "chunks", ... } }`；原始文件只在请求内存中处理 |
| `WS /ws` | 获取连接状态、心跳与通知 | JSON WebSocket 事件 |

聊天接口请求体示例：

```json
{
  "messages": [
    { "role": "user", "content": "比较 AAPL 与 BTC/USDT 的近期表现" }
  ],
  "taskType": "reasoning",
  "review": false,
  "context": {
    "financial": { "tab": "markets", "symbol": "AAPL" }
  }
}
```

SSE 的 `data:` 负载使用 JSON，常见事件包括：

| 事件 `type` | 说明 |
| --- | --- |
| `task` | 本次请求创建的临时任务 ID 和状态。 |
| `delta` | 助手回答的文本增量。 |
| `reasoning` | 上游提供的推理文本增量；前端用于显示思考状态。 |
| `plan` | 服务端裁剪后的任务计划快照，包含步骤标题、当前步骤和完成状态。 |
| `agent` | 研究模式子 Agent 的启动、完成或跳过状态。 |
| `approval` | review 模式下工具执行前的审批请求；前端可批准或拒绝。 |
| `tool` | 服务端即将执行一个已校验的工具调用。 |
| `tool_result` | 工具执行结果或结构化错误码。 |
| `error` | 聊天、上游或工具链路错误。 |
| `done` | 本轮流式输出结束。 |

将聊天请求的 `review` 设为 `true` 可开启本轮人工复核。模型产生工具调用后，服务端先发送 `approval` 事件并暂停当前 SSE；前端调用 `/api/approvals/:id/approved` 或 `/api/approvals/:id/rejected`，原请求随后继续执行或携带 `approval_rejected` / `approval_expired` 结果让模型收尾。默认 `review=false`，不会增加审批等待。

### 研究报告导出

金融模式完成并成功解析结构化研究报告后，消息卡片会显示“导出 PDF”和“导出 PPTX”。浏览器仅将已经严格解析的标题、结论、依据、风险和数据时间发送至导出接口；服务端再次验证相同契约并生成内存中的文件，然后返回短期下载链接，前端通过普通 `<a>` 点击触发下载。

下载链接是服务端随机生成的不可猜测令牌，默认仅在进程内保留 5 分钟，服务重启后立即失效；服务端不保存报告、不创建后台任务，也不做跨设备会话同步。链接属于持有即访问的能力凭证，生产环境应通过 HTTPS 传输并避免写入日志或公开分享。

导出请求体固定为以下形式，浏览器不传递模型原始 Markdown、工具原始输出、URL、客户端模板或文件名：

```json
{
  "report": {
    "title": "AAPL 研究摘要",
    "conclusion": "结合实时行情继续判断短线波动。",
    "evidence": [
      { "claim": "报价处于近期区间内", "source": "yahoo-finance", "observedAt": "2026-08-13T02:00:00.000Z" }
    ],
    "risks": ["数据可能延迟"],
    "asOf": "2026-08-13T02:00:00.000Z"
  }
}
```

PDF 为 A4 研究简报；PPTX 为可编辑的 16:9 三页文档（结论、依据、风险）。直接导出接口和下载链接接口都会设置精确 MIME 类型、`Content-Length`、`Cache-Control: no-store` 和服务端生成的 ASCII 附件文件名。无效格式或报告契约会返回 `400` 与 `invalid_request`；PDF 无法加载 CJK 字体时会返回受控错误，避免下载缺字文件；过期或不存在的令牌返回 `404` 与 `not_found`。macOS 默认使用系统 Unicode 字体；Linux 生产环境应通过 `PDF_CJK_FONT_PATH` 配置已授权的 CJK TrueType/OpenType 字体绝对路径。

## 模型工具与市场数据

### 工具安全契约

服务端只在部署时代码中构造前文列出的六个不可变 ToolManifest。每个 manifest 同时定义版本、只读风险等级、模型 schema、最大执行时间和执行器；模型与 HTTP 输入都无法注册工具、生成 JavaScript 或访问任意 URL。每次调用必须匹配闭合 schema 的字段、类型和长度约束，且不允许额外字段。未知工具、无效 JSON、非法参数、超时、请求取消和数据源不可用都会返回结构化错误码，而不会执行任意网络请求。

工具结果遵循最小暴露原则：服务端只保留允许的文本、数值、时间戳和稳定标识符。新闻 URL、未允许字段、嵌套结构中的链接/IP 字面量以及内部异常细节不会透传给浏览器或模型。

### 市场与数据源

| 市场 | 代码示例 | 当前供应商 | 延迟标记 |
| --- | --- | --- | --- |
| 中国股票 | `600519.SH`、`000001.SZ` | 东方财富；可恢复失败时回退腾讯 | `unknown` |
| 港股 | `0700.HK` | 腾讯 | `unknown` |
| 美股 | `AAPL`、`AAPL.US` | Yahoo Finance | `unknown` |
| 加密货币 | `BTC/USDT` | Binance | `exchange` |

资产搜索会优先处理内置样例、直接代码和已配置的搜索供应商。新闻检索使用 Google News RSS，适合个人学习或演示；新闻结果带有稳定的 `news-1` 形式引用 ID，研究报告只能引用当前请求成功工具结果中的引用 ID或安全供应商标识，前端会拒绝无法在本次工具账本中找到的来源；原始 URL 不会透传给模型。生产环境必须替换为已获授权并符合业务、隐私和可用性要求的服务。

### 模型路由与故障切换

默认只使用 `DEEPSEEK_*` 配置。需要备用模型时，必须同时配置：

```bash
MODEL_FALLBACK_API_KEY=your_fallback_api_key
MODEL_FALLBACK_BASE_URL=https://fallback.example
MODEL_FALLBACK_NAME=fallback-model
```

可按任务类型配置专用模型槽位；每个槽位必须同时配置 API Key、绝对 HTTP(S) 地址和模型名：

```bash
MODEL_FAST_API_KEY=your_fast_api_key
MODEL_FAST_BASE_URL=https://fast.example
MODEL_FAST_NAME=fast-model
MODEL_REASONING_API_KEY=your_reasoning_api_key
MODEL_REASONING_BASE_URL=https://reasoning.example
MODEL_REASONING_NAME=reasoning-model
MODEL_STRUCTURED_API_KEY=your_structured_api_key
MODEL_STRUCTURED_BASE_URL=https://structured.example
MODEL_STRUCTURED_NAME=structured-model
```

客户端只能提交 `fast`、`reasoning` 或 `structured` 三个固定值；缺少对应槽位时使用默认模型。专用槽位仍受现有超时、重试、熔断和零输出故障切换约束。

### 临时任务运行时

`POST /api/chat/stream` 的首个 SSE 事件为 `task`，其中的随机 ID 可用于查询或取消本次进程内运行。任务状态只包含 `running`、`completed`、`failed`、`cancelled` 和过期前的计数/时间，不包含消息、工具参数或上游异常。默认 TTL 为 10 分钟、最多保留 100 个任务；它不是后台队列，也不承诺服务重启或 SSE 断开后的恢复。

备用端点使用与 DeepSeek 客户端相同的流式 OpenAI 兼容协议。它不是模型轮询或回答拼接器：只有主模型在输出任何 `delta`、推理或工具调用事件之前返回 `model_unavailable`，服务端才会把同一请求交给备用模型。

天气工具在用户明确给出城市时使用城市进行地理编码；未给出城市时才可能使用客户端 IP 获取固定地理位置。应用不会持久化该 IP。反向代理部署时，只有在确认恰好一层受信任代理的前提下才可开启 `TRUST_PROXY=true`，否则伪造的转发 IP 可能影响定位。

技术指标和经济日历同样遵守字段白名单、URL/IP 清洗和取消传播。技术指标只允许固定日线/月窗口；经济日历只允许固定的公开周度 JSON 源，网关为请求和 JSON 读取设置超时，不把原始上游响应、链接或异常细节暴露给模型或浏览器。

## 运行观测与交付

`InstrumentedToolExecutor` 位于工具端口之外，只对已清洗的注册表结果记录聚合遥测。Prometheus 指标使用固定标签集合，覆盖固定工具名、成功/失败、延迟直方图、新鲜度和外部来源最近状态；不会记录用户文本、工具参数、URL、IP、密钥或原始工具结果。

GitHub Actions CI 在推送和拉取请求中依次运行类型检查、完整测试集和前端生产构建。本地性能基线使用无网络的模拟 Agent 流检查首事件和完整运行时延；部署 smoke 检查只访问健康端点。

## Agent 能力矩阵

当前能力、计划透明度、研究子 Agent、引用校验、模型故障切换、人工审批，以及文件输入、连接器、后台任务和浏览器操作等后续缺口，统一记录在 [`docs/agent-capability-gap-analysis.md`](docs/agent-capability-gap-analysis.md)。涉及权限、数据保留或外部副作用的能力会先完成边界设计，再进入实现。

## 安全与隐私边界

- 服务端绑定到 `127.0.0.1`，并只允许 `CLIENT_URL` 指定的来源跨域访问。
- 模型只接收服务端拥有的系统指令；所有工具输出被视为不可信外部数据，不能改变系统策略。
- 市场网关仅访问代码中列出的允许源，并在超时、限流、无效响应或取消时返回受控错误。
- 新闻发布时间会与服务端当前时间比对，未来时间戳会被排除；模型只能基于带来源的数据总结，不能把标题元数据当作已验证事实。
- 会话和离线队列存储在浏览器本地。清除会话会删除对应的本地消息和待重试项目。

## 工程结构

```text
.
├── src/
│   ├── App.tsx                    # 应用状态、会话、离线队列和金融上下文
│   ├── components/                # 登录、侧栏、对话、消息与金融工作台
│   └── lib/                       # SSE、WebSocket、IndexedDB、历史与资产搜索客户端
├── server/
│   ├── main.ts                    # 唯一运行时入口、Nest 应用与 WebSocket 装配
│   ├── api/                       # Nest 控制器：健康检查、聊天 SSE、能力、任务、文档、市场搜索与报告下载
│   ├── application/               # 聊天、文档、能力、任务、市场与报告导出用例、端口定义
│   ├── domain/                    # 消息、工具、错误合同
│   ├── infrastructure/            # 配置、DeepSeek 客户端与工具适配器
│   │   ├── runtime/                # 工具遥测包装器与 Prometheus 聚合指标
│   │   ├── documents/               # PDF 文本层提取、扫描 PDF/图片 OCR
│   │   └── export/                 # PDF/PPTX 渲染器与短期下载链接存储
│   ├── sse.ts                     # DeepSeek SSE 解析与事件格式化
│   ├── tools/                     # 受基础设施适配器调用的工具实现
│   ├── market/                    # 受基础设施适配器调用的市场实现
│   ├── economic-calendar/          # 固定公开周度经济日历网关
│   └── agent/                     # LangGraph 状态机、工具调用循环、子 Agent 注册表与协调器
├── shared/                         # 浏览器与服务端共用的报告校验契约
│   ├── agent-events.ts             # SSE 计划和子 Agent 事件共享契约
│   ├── document.ts                 # 文档摘要、来源类型和 OCR 元数据契约
│   └── research-citations.ts       # 工具结果引用账本
├── scripts/smoke.ts                # 可选的已部署健康检查
├── .github/workflows/ci.yml        # 类型检查、测试和构建的 CI
├── tests/                         # Node 内置测试运行器的覆盖用例
├── .env.example                   # 可提交的环境变量模板
└── package.json                   # 脚本与依赖
```

## 测试与构建

```bash
# 运行全部测试
pnpm test

# 进行 TypeScript 类型检查
pnpm typecheck

# 构建 Vite 前端产物
pnpm build

# 无网络模拟性能基线（已包含在完整测试集中）
pnpm exec tsx --test tests/performanceBaseline.test.ts

# 已部署实例健康检查；未设置时以成功状态跳过
pnpm test:smoke

# 例如：检查指定部署
SMOKE_BASE_URL=https://example.com pnpm test:smoke

# 提交前执行完整门禁
pnpm typecheck && pnpm test && pnpm build && pnpm test:smoke && git diff --check
```

测试覆盖 Agent 规划与可见计划、能力清单、任务级模型路由、子 Agent 预算、文档摘要校验、PDF/图片 OCR、请求级向量召回、本地工作记忆与文档召回、临时任务取消/过期、并行顺序、失败/陈旧收敛、DeepSeek 流、SSE 解析、六个 ToolManifest、技术指标、经济日历、工具遥测、研究报告解析与 PDF/PPTX 导出、无网络性能基线、资产搜索、行情网关、历史记录、离线队列、金融工作台和界面样式等关键行为。

## 限制与免责声明

- 本项目是学习与演示用途的金融 AI Agent，不构成投资、交易、法律或税务建议。
- 不提供账户体系、订单管理、资金划转、下单或自动交易能力。
- 不提供服务端持久化记忆、跨设备会话、向量数据库或持久化索引；文档上传后的向量召回仅在当前请求内运行，前端工作记忆和历史附件仍保存在当前浏览器 IndexedDB/运行时，图状态、人工审批等待和临时任务仅存活于当前请求/进程，服务重启或 SSE 断开后无法恢复。
- 当前计划和子 Agent 协作状态都是本次请求内的可见快照，不支持用户编辑计划、后台运行、定时触发或跨设备恢复。
- 外部数据源可能延迟、缺失、限流、变更或不可用；结果应以供应商实际返回的来源和时间元数据为准。
- 生产使用前，应独立评估模型供应商、新闻和市场数据的授权、服务条款、隐私、审计、监控、容量与合规要求。
