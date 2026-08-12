# 全量框架化架构设计

## 背景与目标

服务端现已完成从 Express 单体入口到 NestJS 模块化运行时的迁移。聊天编排通过应用端口与 HTTP/SSE 响应解耦，并保留浏览器已经使用的 API、SSE 事件格式、工具安全约束与市场数据行为。

本次改造的交付目标为：

- NestJS 是唯一服务端 HTTP/WebSocket 框架，旧 Express 运行入口和遗留编排已删除。
- API、应用、领域、基础设施四层保持单向依赖；应用层通过 `AgentRunner` 端口调用 LangGraph。
- LangGraph 驱动在线 Agent 循环：`plan -> agent -> tools -> evaluate -> final`。
- 统一配置校验、请求 ID、安全日志、错误映射、health/ready/metrics、DTO 与测试边界。
- 保持 `POST /api/chat/stream`、`GET /api/market/search`、`GET /api/health`、`WS /ws` 以及 SSE 事件兼容，并新增 `GET /api/ready` 与 `GET /api/metrics`。

非目标：用户身份服务、持久化 Agent 记忆、向量数据库、交易下单、改变前端业务交互或接入任意 URL 的工具。

## 目标分层

```text
server/
  api/                 Nest 控制器、网关、DTO、SSE 响应适配器
  application/         Chat、MarketSearch、ToolExecution 用例与端口
  domain/              消息、工具、市场、错误码、Agent 状态等纯规则
  infrastructure/      DeepSeek、新闻、天气、市场供应商、缓存、日志实现
  agent/               LangGraph 图、节点、状态与路由规则
  app.module.ts        根模块与配置装配
  main.ts              Nest 启动入口
```

- `api` 只能依赖 `application` 和公开 DTO；`SseEventWriter` 是唯一可序列化 SSE、处理 `done` 幂等和断连的组件。
- `application` 依赖 `domain` 中定义的端口，不依赖 Nest、Fetch、Express 或具体供应商。
- `infrastructure` 实现应用端口，并可依赖外部 SDK、HTTP、缓存和日志。
- `agent` 只编排应用服务和领域状态；工具调用不直接触碰 HTTP 响应。
- 依赖注入令牌统一在应用层定义，`AppModule` 作为组成根将 `LangGraphAgentRunner` 绑定给 `AGENT_RUNNER`。

## 在线聊天与 LangGraph

每次请求构造短生命周期图状态，不使用 checkpoint 或跨会话记忆；`ChatApplicationService` 只依赖 `AgentRunner`：

```text
ChatController
  -> ChatApplicationService
  -> AgentRunner -> LangGraph
       plan_request: 生成不超过三步的内部计划
       model_agent: 请求 DeepSeek 并增量发出 delta/reasoning
       execute_tools: 校验并调用受控工具，发出 tool/tool_result
       evaluate_next: 判断继续调用、强制最终回答或结束
       finalize: 保证 done 事件恰好一次
```

图状态包含已过滤的模型消息、计划、挂起工具调用、轮次、调用次数、取消信号和最终化标记。状态不得包含原始供应商响应、客户端注入的 `system`/`tool` 消息或未清洗 URL/IP 内容。计划不得进入 SSE、客户端消息、持久化历史或日志；当前计划步骤可作为服务端拥有的内部 system instruction 进入模型请求，用于约束模型的下一次工具选择或最终回答。

现有安全语义必须保持：最多 3 个工具轮次、6 次调用；取消会传递到模型和工具；工具输出作为不可信数据；所有工具参数使用闭合 schema 校验；达到限制后模型只可给出最终回答。工具仅通过部署期不可变 `ToolManifest` 注册，每份 manifest 同时绑定版本、风险等级、schema、执行时限和执行器；模型或 HTTP 输入无法动态注册工具。

## 对外契约与错误策略

HTTP 路径和浏览器 SSE 事件不变。SSE 保持 `delta`、`reasoning`、`tool`、`tool_result`、`error`、`done`，并由 API 层的 `SseEventWriter` 唯一序列化、去重终态和记录断连。

错误统一映射为领域错误码：请求无效、请求取消、工具不可用、供应商异常、模型异常和内部异常。生产响应不暴露堆栈或供应商原始内容；结构化日志保留错误类型、`requestId`、工具名、耗时和安全的错误码。

市场、新闻、天气和资产搜索仍只能使用当前固定允许来源。市场网关保留符号规范化、超时、缓存、并发去重、来源元数据和可恢复回退。

## 配置、可观测性与运行时

- 使用 `@nestjs/config` 加载 `.env`，并在启动时校验 DeepSeek、端口、允许前端源、代理和模型韧性配置。
- 新增请求 ID 中间件；SSE、HTTP 与 WebSocket 日志均携带该 ID 或连接 ID。
- 使用 Nest `Logger` 的 JSON 风格封装，不记录 API Key、完整用户消息、URL/IP 或未清洗工具输出。
- `/api/health` 是 liveness；`/api/ready` 在模型未配置或熔断时返回 503；`/api/metrics` 以 Prometheus 文本暴露安全聚合指标。上述端点不主动探测外部供应商。
- `ResilientModelClient` 对 Planner 和正式回答共享总时限、首事件/空闲时限、一次有限重试和半开熔断器；用户取消优先于超时与重试。
- WebSocket 使用 Nest Gateway 保持 `/ws`、`status`、`ping`、`pong`、`notice` 行为。

## 测试与迁移策略

迁移已按垂直切片完成：Nest 根模块与兼容路由、应用端口/基础设施、LangGraph、模型韧性、SSE writer、ToolManifest 和遗留 Express 编排清理均已落地。测试覆盖控制器 SSE 契约、LangGraph 路由、配置校验、请求 ID/错误映射、模型熔断和工具 schema/超时。

严格 TypeScript 继续开启，不通过关闭 `strict`、排除源码或 `@ts-nocheck` 回避错误。完成标准：构建、完整测试集和 `pnpm typecheck` 全部通过；前端不需要改动 API 路径或 SSE 解析逻辑。
