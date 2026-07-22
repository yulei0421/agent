# 全量框架化架构设计

## 背景与目标

当前服务端以 Express 单体入口和多个函数模块组成；聊天流式编排、模型请求、工具执行与 HTTP/SSE 响应仍有交叉职责。项目将迁移到 NestJS 的模块化和依赖注入体系，同时保留浏览器已经使用的 API、SSE 事件格式、工具安全约束与市场数据行为。

本次改造的交付目标为：

- 使用 NestJS 作为唯一服务端 HTTP/WebSocket 框架，并停止 Express 运行入口。
- 形成 API、应用、领域、基础设施四层的单向依赖。
- 让 LangGraph 驱动在线 Agent 循环：`plan -> agent -> tools -> evaluate -> final`。
- 统一配置校验、请求 ID、结构化日志、错误映射、健康检查、DTO 与测试边界。
- 保持 `POST /api/chat/stream`、`GET /api/market/search`、`GET /api/health`、`WS /ws` 以及 SSE 事件兼容。

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

- `api` 只能依赖 `application` 和公开 DTO；不直接访问供应商或工具实现。
- `application` 依赖 `domain` 中定义的端口，不依赖 Nest、Fetch、Express 或具体供应商。
- `infrastructure` 实现应用端口，并可依赖外部 SDK、HTTP、缓存和日志。
- `agent` 只编排应用服务和领域状态；工具调用不直接触碰 HTTP 响应。
- 依赖注入令牌统一在应用层定义，基础设施层在 Nest 模块中绑定实现。

## 在线聊天与 LangGraph

每次请求构造短生命周期图状态，不使用 checkpoint 或跨会话记忆：

```text
ChatController
  -> ChatApplicationService
  -> LangGraph
       plan_request: 生成不超过三步的内部计划
       model_agent: 请求 DeepSeek 并增量发出 delta/reasoning
       execute_tools: 校验并调用受控工具，发出 tool/tool_result
       evaluate_next: 判断继续调用、强制最终回答或结束
       finalize: 保证 done 事件恰好一次
```

图状态包含已过滤的模型消息、计划、挂起工具调用、轮次、调用次数、取消信号和最终化标记。状态不得包含原始供应商响应、客户端注入的 `system`/`tool` 消息或未清洗 URL/IP 内容。

现有安全语义必须保持：最多 3 个工具轮次、6 次调用；取消会传递到模型和工具；工具输出作为不可信数据；所有工具参数使用闭合 schema 校验；达到限制后模型只可给出最终回答。

## 对外契约与错误策略

HTTP 路径和浏览器 SSE 事件不变。SSE 保持 `delta`、`reasoning`、`tool`、`tool_result`、`error`、`done`，并由 API 层的 `SseEventWriter` 唯一序列化。

错误统一映射为领域错误码：请求无效、请求取消、工具不可用、供应商异常、模型异常和内部异常。生产响应不暴露堆栈或供应商原始内容；结构化日志保留错误类型、`requestId`、工具名、耗时和安全的错误码。

市场、新闻、天气和资产搜索仍只能使用当前固定允许来源。市场网关保留符号规范化、超时、缓存、并发去重、来源元数据和可恢复回退。

## 配置、可观测性与运行时

- 使用 `@nestjs/config` 加载 `.env`，并在启动时校验 DeepSeek、端口、允许前端源和代理配置。
- 新增请求 ID 中间件；SSE、HTTP 与 WebSocket 日志均携带该 ID 或连接 ID。
- 使用 Nest `Logger` 的 JSON 风格封装，不记录 API Key、完整用户消息、URL/IP 或未清洗工具输出。
- `/api/health` 返回应用和必要依赖配置状态；不主动探测外部行情供应商。
- WebSocket 使用 Nest Gateway 保持 `/ws`、`status`、`ping`、`pong`、`notice` 行为。

## 测试与迁移策略

迁移按垂直切片进行：先搭建 Nest 根模块与兼容路由，再搬运应用端口/基础设施实现，随后接入 LangGraph，最后移除 Express 入口。每一步均运行现有行为测试，并新增：控制器 SSE 契约测试、LangGraph 路由测试、配置校验测试、请求 ID/错误映射测试。

严格 TypeScript 继续开启，不通过关闭 `strict`、排除源码或 `@ts-nocheck` 回避错误。完成标准：构建、完整测试集和 `pnpm typecheck` 全部通过；前端不需要改动 API 路径或 SSE 解析逻辑。
