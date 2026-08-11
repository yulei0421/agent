# 无状态生产化加固设计

## 目标与范围

本设计将当前金融 Agent Demo 提升为可观测、可降级、边界清晰的无状态服务。它处理模型调用的超时与熔断、健康与运行指标、SSE 传输抽象、Agent 分层、遗留编排清理，以及受控工具的声明式注册。

本次不包含账户认证、权限、限流、服务端持久化记忆、跨设备会话、数据库、向量检索或可暂停并恢复的人工审批流程。浏览器 IndexedDB 会话历史保持本地功能；LangGraph 状态仍只存活于单个 HTTP 请求。

## 运行时韧性

模型调用通过 `ResilientModelClient` 包装现有 `DeepSeekClient`。包装器是内存内单例，供 Planner 和正式回答共用，包含：

- 总请求截止时间、首个模型事件截止时间和流空闲截止时间；任何一个触发都会中止下游请求并映射为公共 `model_unavailable` 错误。
- 仅当本轮尚未向浏览器发送任何模型事件、调用不是用户取消且失败可恢复时，最多重试一次。已经输出过内容的流绝不重试，避免重复回答或重复工具调用。
- 记录连续可恢复失败；达到阈值后打开短暂熔断器。熔断期间立即失败，不再消耗供应商配额；冷却结束后允许一次探测调用，成功则关闭熔断器。
- 用户 `AbortSignal` 始终优先，取消必须保持 `request_aborted`，不得被超时或重试改写。

超时、重试次数、熔断阈值和冷却时间从已校验的环境配置读取，并提供适合本地运行的保守默认值。包装器只管理模型网络调用，不修改工具注册、工具参数校验或工具调用上限。

## 健康与可观测性

新增进程内 `RuntimeTelemetry`，只保存计数器、直方图摘要和当前模型运行状态，不保存用户文本、API Key、URL、IP 或工具原始结果。聊天、Planner、模型、工具、SSE 断连和市场搜索都写入统一的安全字段。

健康端点拆分为：

- `GET /api/health`：liveness；进程可接受 HTTP 请求时返回 200。
- `GET /api/ready`：readiness；返回模型是否已配置、熔断状态和服务可用性。模型未配置或熔断时返回 503 与公共状态，不探测外部行情供应商。
- `GET /api/metrics`：Prometheus 文本格式的进程指标，仅暴露请求计数、延迟、模型重试/超时/熔断、工具结果和 SSE 断连计数；部署层负责网络隔离与访问控制。

所有 HTTP、SSE 和 WebSocket 成功与失败路径使用 `requestId` 或 `connectionId` 关联。启动日志仅输出监听地址，异常仍经结构化安全日志记录。

## SSE 与应用边界

API 层新增 `SseEventWriter`，唯一负责 SSE 响应头、事件 JSON 序列化、`done` 去重、可写状态判断、写入耗时统计和连接关闭。`ChatController` 只负责构造请求取消信号和调用应用用例；不再直接调用 `formatSse` 或 `response.write`。

应用层定义 `AgentRunner` 端口和 `AGENT_RUNNER` 注入令牌。`ChatApplicationService` 仅负责过滤客户端消息、注入可信上下文并调用端口；`LangGraphAgentRunner` 位于 `server/agent/`，实现该端口并持有 Graph、模型、Planner 与工具依赖。由 Nest composition root 绑定实现，消除 application 对 `server/agent` 的直接导入。

## 受控工具声明

现有工具改为通过不可变 `ToolManifest` 注册：工具名称、版本、面向模型的描述、闭合参数 schema、风险级别、最大执行时间和执行适配器必须一起定义。`ToolExecutor.definitions()` 只从 manifest 发布工具，执行时按同一 manifest 校验并设置超时。

新增工具只能作为部署时代码或配置注册，必须提供 manifest 与测试；模型没有写入注册表、生成 JavaScript、任意 URL 访问或绕过 schema 的能力。当前天气、新闻、资产搜索和报价工具保持只读，因此不加入人工审批节点。若未来需要交易、写入或高风险工具，必须先引入可持久化的审批会话，再设计恢复协议。

## 遗留代码与迁移

删除不在生产路径、且不再被测试依赖的 `server/legacy/deepseek.ts` 与 `server/legacy/market-search.handler.ts`。对应架构边界测试更新为断言遗留实现不存在，避免未来误接入旧 Express 协议。

迁移顺序为：先用失败测试锁定韧性与健康语义；实现运行时包装和 telemetry；抽取 SSE writer；引入 AgentRunner port；将工具注册迁移到 manifest；最后删除 legacy 文件并更新 README、架构设计与运行文档。

## 验收标准

- 模型、Planner 与流读取都受超时、取消、一次有限重试和熔断保护；重复工具执行不发生。
- health、ready 与 metrics 反映配置和内存运行状态，且不泄露敏感数据。
- SSE 事件顺序、公共事件形状与 `done` 恰好一次的契约保持兼容。
- `ChatApplicationService` 不再导入 Agent 实现；所有生产模型、工具和 Agent 依赖只由 Nest 组成根装配。
- 工具 schema 与执行路径源自同一个 manifest，现有工具行为和安全限制不回归。
- legacy Express 编排文件被删除；`pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check` 全部通过。
