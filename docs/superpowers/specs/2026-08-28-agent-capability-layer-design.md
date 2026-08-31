# Agent 能力层增强设计

> 实施补充（2026-08-31）：在本设计的无持久化边界内，已追加二进制文档输入能力。`POST /api/documents/ingest` 接收受限的 PDF/图片 base64，服务端使用 PDF.js 提取文本层，并使用 Tesseract.js + canvas 对扫描 PDF/图片执行 OCR；聊天请求再对已校验文档做请求级 cosine 向量召回。以下“本轮不实现 PDF 二进制解析和 OCR”是原始设计阶段的范围说明，不代表当前实现状态。

## 目标

对照主流研究型 Agent 的通用能力，在现有 React + NestJS + LangGraph 架构上补齐可在无服务端持久化条件下安全运行的能力。新增能力必须保持只读金融边界、可取消、可观测，并且不允许模型动态注册任意工具。

## 当前基础

项目已经具备：

- LangGraph 计划、工具循环、失败收敛和工具调用前审批；
- 固定六项 `ToolManifest`、闭合参数 schema、执行超时和取消；
- DeepSeek 流式输出、备用模型健康切换、结构化金融研究报告；
- 本地 IndexedDB 会话、离线队列、PDF/PPTX 导出和聚合遥测。

## 缺口与本轮范围

### 本轮接入

1. 能力清单：将工具、子 Agent 和模型能力统一为服务端只读 manifest，公开名称、版本、风险、预算、超时和支持的任务类型。
2. 任务级模型路由：按 `fast`、`reasoning`、`structured` 三类任务选择已配置模型；主模型不可用时沿用健康优先切换；未配置路由目标时保持现有模型。
3. 可配置子 Agent：固定角色注册表支持角色描述、最大并发、最大输出条数、超时和失败隔离；主 Graph 仍是唯一工具执行者。
4. 文档输入增强：服务端接收经过大小、类型和字符数限制的文本附件摘要，拒绝二进制内容和潜在 URL/IP 注入；保留浏览器本地读取，不上传独立文件存储。
5. 引用账本增强：引用记录增加来源标签、观测时间、数据新鲜度和过期状态；结构化报告只能引用本轮账本中的记录。
6. 临时任务运行时：为当前进程内的长 Agent 运行提供任务 ID、状态、取消、重试次数和进度事件；服务重启、SSE 断开或 TTL 到期后任务不可恢复。
7. 本地上下文智能：在浏览器中生成有上限的工作记忆，并对历史文本附件做词法分片召回；只把经过限制的参考片段发送给现有聊天入口，不引入服务端持久化或向量数据库。
8. 能力清单 UI：前端消费服务端脱敏 manifest，在侧栏展示能力类别和描述，失败时不阻塞聊天。

### 明确不接入

- 服务端持久化记忆、跨设备会话、数据库 checkpoint；
- OAuth/MCP 外部连接器；
- 任意浏览器或计算机控制；
- 交易、下单、资金操作和其他外部副作用。

## 架构

```text
Chat 请求
  -> CapabilityRegistry（只读能力清单）
  -> TaskRuntime（任务 ID、取消、TTL、进度）
  -> ModelRouter（任务类型 -> 已配置模型）
  -> LangGraph
       -> SubAgentRegistry（固定角色、预算、隔离）
       -> ToolManifestRegistry（唯一工具执行入口）
  -> SSE（task / plan / agent / tool / tool_result / delta / done）
```

### 能力清单

`CapabilityManifest` 仅由服务端代码构造并冻结，包含：`name`、`kind`、`version`、`riskLevel`、`timeoutMs`、`maxCalls`、`taskTypes`。模型收到的工具定义仍只来自现有 `ToolManifest`；能力清单只用于路由、观测和 UI 展示，不能变成动态工具注册接口。
前端仅调用 `GET /api/capabilities` 获取 `PublicCapability` 摘要，并在侧栏展示固定字段；解析失败或请求失败只隐藏清单，不影响聊天请求。

### 模型路由

`ModelRouter` 实现现有 `ModelClient` 端口。请求携带可选 `taskType`，路由到对应客户端；客户端未配置时回退默认客户端。路由选择只读取服务端配置，客户端不能指定任意 URL、密钥或模型。路由事件仅记录固定的任务类型和模型槽位，不记录提示词。

### 子 Agent

`SubAgentRegistry` 只允许服务端声明的角色。每次协作运行并发不超过注册表上限，每个角色独立超时；一个角色失败不会阻塞其他角色，结果作为不可信规划提示交给主 Graph。子 Agent 不接收工具定义，不得执行网络请求。

### 文档输入

前端对文本文件继续在浏览器读取并发送 `{name, mimeType, text}` 摘要；PDF/图片先调用 `POST /api/documents/ingest`，服务端重新校验名称、MIME、扩展名、base64、magic bytes 和 8 MB 大小，再提取受限文本。PDF 优先读取文本层，文本层为空时对最多 8 页渲染并 OCR；PNG/JPG/WEBP 直接 OCR。原始二进制只在请求内存中处理，不写入独立文件存储。

### 本地工作记忆与文档召回

每次成功完成对话后，前端从最近已完成的用户/助手轮次生成最多 1200 个字符的本地摘要，并保存在当前浏览器会话记录中。下一轮请求会把摘要作为明确标记的参考消息加入历史预算；它不具备系统消息权限，也不写入服务端。浏览器先按固定字符窗口做本地召回；服务端收到摘要后再构造 token-count 向量，以 cosine similarity 对文档分块排序，最多召回四个文档、每个文档最多 3500 个字符。向量只存在当前请求，不接入向量数据库或持久索引。

### 临时任务

任务状态保存在进程内，包含 `queued`、`running`、`completed`、`failed`、`cancelled`、`expired`。默认 TTL 为 10 分钟，最多保留 100 个任务。SSE 请求创建任务并返回 `task` 事件；取消请求或连接断开触发 `AbortController`。任务只允许创建者持有的随机令牌访问，令牌不写日志。

## API 与事件

- `POST /api/chat/stream`：兼容现有请求，新增可选 `taskType` 和已校验的文档摘要；首个事件增加 `task` 元数据。
- `POST /api/tasks/:id/cancel`：取消当前进程内任务，重复取消幂等。
- `GET /api/tasks/:id`：返回不含提示词和工具参数的任务状态摘要。
- `GET /api/capabilities`：返回公开能力名称、版本、风险和是否需要审批，不返回执行器细节。
- `POST /api/exports/research/:format/link`：服务端校验已完成的研究报告并在进程内生成短期下载链接，`format` 仅允许 `pdf` 或 `pptx`。
- `GET /api/exports/research/download/:token`：使用服务端生成的随机令牌下载已生成文档；令牌过期或服务重启后返回 `404`。
- 研究引用通过本地引用账本随消息持久化，不新增独立 `citation` SSE 事件；既有 `plan`、`agent`、`tool`、`tool_result`、`delta`、`error`、`done` 保持兼容。

## 安全与失败策略

- 所有输入仍由应用层 schema 校验，未知字段拒绝或丢弃，不把客户端能力声明当作权限。
- 模型路由、子 Agent 和任务运行时都受请求 `AbortSignal` 约束；超时返回受控错误码。
- 任务状态查询只返回固定枚举、时间和计数；不暴露原始消息、工具参数、上游 URL 或异常堆栈。
- 任务过期、服务重启和 SSE 断开均不可恢复，前端显示“请重新发起”；不伪造后台完成。

## 验收标准

1. `pnpm typecheck`、`pnpm build` 和完整 Node 测试通过（若沙箱禁止 IPC listen，需单独使用 `node --import tsx` 运行非监听测试并记录环境限制）。
2. 能力清单、模型路由、子 Agent 预算、文档摘要校验、引用状态和任务取消分别有单元测试。
3. 现有自动工具循环、`review=false`、研究报告导出和本地会话行为保持兼容。
4. `README.md` 与能力矩阵明确新增能力及无状态限制。
