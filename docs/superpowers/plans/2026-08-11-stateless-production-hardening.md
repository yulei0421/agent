# 无状态生产化加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入服务端持久化、账户或限流的前提下，完成 Agent 服务的模型韧性、健康可观测性、SSE 边界、分层解耦、工具 manifest 与遗留清理。

**Architecture:** 用进程内 `RuntimeTelemetry` 和 `ResilientModelClient` 装饰现有模型端口，实现超时、有限重试和熔断。API 层集中 SSE 写入与健康指标；application 只依赖 `AgentRunner` 端口，LangGraph 与工具 manifest 保留在适配器层并由 Nest 组成根装配。

**Tech Stack:** TypeScript strict、NestJS 11、LangGraph、Node.js test runner、Prometheus exposition text、Express Response 类型。

---

## 文件结构

- `server/infrastructure/runtime/runtime-telemetry.ts`：进程内计数、延迟、模型状态与 Prometheus 文本输出。
- `server/infrastructure/deepseek/resilient-model-client.ts`：模型总时限、首事件/空闲时限、一次重试与熔断装饰器。
- `server/infrastructure/config/app-config.service.ts`：模型韧性配置及受限解析。
- `server/api/health/health.controller.ts`、`server/api/health/metrics.controller.ts`：liveness、readiness 与 metrics。
- `server/api/chat/sse-event-writer.ts`：唯一 SSE 写入器。
- `server/application/chat/chat.ports.ts`：`AgentRunner`、运行请求和 `AGENT_RUNNER` token。
- `server/agent/langgraph-agent-runner.ts`：LangGraph 到应用端口的适配器。
- `server/domain/tools/tool.types.ts`、`server/tools/registry.ts`：工具 manifest 与单一 schema/执行定义。
- `server/app.module.ts`、控制器和测试：组成根与公开契约。

### Task 1: 模型韧性配置、Telemetry 与装饰器

**Files:**
- Create: `server/infrastructure/runtime/runtime-telemetry.ts`
- Create: `server/infrastructure/deepseek/resilient-model-client.ts`
- Modify: `server/infrastructure/config/app-config.service.ts`
- Modify: `server/application/chat/chat.ports.ts`
- Test: `tests/resilientModelClient.test.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: 写失败测试，锁定取消、超时、重试和熔断**

创建 `tests/resilientModelClient.test.ts`，以可控的 `ModelClient` async generator 验证：预先 abort 返回 `request_aborted`；首事件超时返回 `model_unavailable`；首事件前第一次 `model_unavailable` 后重试一次；已产生 `delta` 后不重试；连续失败达到阈值后短路，冷却后允许探测并在成功时关闭熔断。每个测试读取 `RuntimeTelemetry.modelStatus()`，断言不包含输入文本。

```ts
const client = new ResilientModelClient(failingClient, telemetry, {
  totalTimeoutMs: 100, firstEventTimeoutMs: 10, idleTimeoutMs: 10,
  maxRetries: 1, circuitFailureThreshold: 2, circuitCooldownMs: 50
});
await assert.rejects(collect(client.stream(request, new AbortController().signal)), { code: 'model_unavailable' });
assert.equal(calls, 2);
```

- [ ] **Step 2: 运行新测试并确认红灯**

Run: `pnpm exec tsx --test tests/resilientModelClient.test.ts`

Expected: FAIL，因为 `ResilientModelClient` 与 `RuntimeTelemetry` 尚不存在。

- [ ] **Step 3: 定义配置与安全 telemetry**

在 `AppConfig` 增加 `modelResilience`：`totalTimeoutMs`、`firstEventTimeoutMs`、`idleTimeoutMs`、`maxRetries`、`circuitFailureThreshold`、`circuitCooldownMs`。所有毫秒值必须是 100 至 120000 的整数；重试必须是 0 或 1；阈值必须是 1 至 20。新增 `RuntimeTelemetry`，暴露以下最小 API：

```ts
recordModel(outcome: 'success' | 'timeout' | 'failure' | 'retry' | 'circuit_open', durationMs?: number): void;
recordTool(name: string, ok: boolean, durationMs: number): void;
recordSseDisconnect(): void;
recordHttp(route: string, status: number, durationMs: number): void;
modelStatus(): { configured: boolean; circuit: 'closed' | 'open' | 'half_open' };
metrics(): string;
```

`metrics()` 仅输出固定 metric 名、有限标签和数值；不得接收或输出用户消息、URL、IP、API Key、工具结果或供应商原始错误。

- [ ] **Step 4: 实现 `ResilientModelClient`**

实现 `ModelClient` 装饰器。每次尝试创建子 `AbortController`，监听并转发调用方 signal；以 `Promise.race` 施加总时限、首事件时限和任意两事件之间的空闲时限。只有没有 yield 过 `delta`、`reasoning` 或 `tool_call_delta` 的可恢复 `AppError('model_unavailable')` 才能重试一次。任何 `request_aborted` 立即退出且不计入熔断失败。

熔断器在连续可恢复失败达到阈值后记录 `openUntil`；冷却期内直接抛出 `AppError('model_unavailable')`；冷却结束后的单次探测成功关闭熔断，失败重新开启。完成或失败时必须移除 abort listener、清除 timer 并关闭内部 iterator。

- [ ] **Step 5: 运行模型韧性与配置测试**

Run: `pnpm exec tsx --test tests/resilientModelClient.test.ts tests/config.test.ts`

Expected: PASS，测试覆盖取消优先、三类时限、一次重试、流式不重试、熔断和配置边界。

### Task 2: 健康、Ready 与 Metrics 运行契约

**Files:**
- Modify: `server/api/health/health.controller.ts`
- Create: `server/api/health/metrics.controller.ts`
- Modify: `server/app.module.ts`
- Test: `tests/healthController.test.ts`
- Test: `tests/chatRuntime.test.ts`

- [ ] **Step 1: 写失败测试**

为 health controller 添加下列用例：liveness 总是 `{ status: 'ok' }`；模型未配置时 ready 以 503 返回 `{ status: 'not_ready', model: 'not_configured' }`；熔断打开时返回 `{ status: 'not_ready', model: 'circuit_open' }`；metrics response 是 `text/plain; version=0.0.4`，包含 `agent_model_requests_total` 但不包含 `DEEPSEEK_API_KEY` 或测试消息文本。

- [ ] **Step 2: 运行 health 测试并确认红灯**

Run: `pnpm exec tsx --test tests/healthController.test.ts tests/chatRuntime.test.ts`

Expected: FAIL，因为 ready、metrics controller 与 telemetry 注入尚不存在。

- [ ] **Step 3: 实现端点并装配依赖**

`HealthController` 注入 `AppConfigService` 与 `RuntimeTelemetry`；`check()` 仅表示进程存活。新增 `ready(@Res())`，以 200 或 503 返回公开状态。`MetricsController` 使用 `@Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')` 返回 `telemetry.metrics()`。

在 `AppModule` 注册单例 `RuntimeTelemetry`、`MetricsController`；创建 raw `DeepSeekClient` 或 `UnavailableModelClient` 后以 `ResilientModelClient` 作为唯一 `MODEL_CLIENT` provider，并向 wrapper 提供已校验配置与 telemetry。不要在 health 检查中请求 DeepSeek、市场、新闻或天气供应商。

- [ ] **Step 4: 运行 health/metrics 测试**

Run: `pnpm exec tsx --test tests/healthController.test.ts tests/chatRuntime.test.ts`

Expected: PASS，既有 chat SSE 契约、未配置模型公共错误码与新的 health/readiness/metrics 均兼容。

### Task 3: 抽取 SSE writer 并记录传输结果

**Files:**
- Create: `server/api/chat/sse-event-writer.ts`
- Modify: `server/api/chat/chat.controller.ts`
- Test: `tests/sseEventWriter.test.ts`
- Test: `tests/chatController.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `SseEventWriter` 测试，使用记录 headers、writes、end 的 fake response，验证 `start()` 设置现有三个 SSE headers 并 flush；`write()` 序列化事件；第二个 `done` 不重复写；关闭或 `writableEnded` 后不写；`finish()` 只 end 一次；disconnect 递增 telemetry 而不写 error。

- [ ] **Step 2: 运行 SSE writer 测试并确认红灯**

Run: `pnpm exec tsx --test tests/sseEventWriter.test.ts tests/chatController.test.ts`

Expected: FAIL，因为 writer 尚不存在且 controller 仍直接使用 `formatSse`。

- [ ] **Step 3: 实现 writer 并替换 controller 直接写入**

`SseEventWriter` 构造参数为 `Response`、`RuntimeTelemetry`、route。`start()` 只执行一次；`write(event)` 通过现有 `formatSse` 写入且对 `done` 幂等；`close()` 标记关闭并调用 `recordSseDisconnect()`；`finish()` 结束尚未结束的 response。将 `ChatController` 的 header、`response.write`、`response.end` 和 done 行为全部委托给 writer，保留当前 client abort、公共错误映射与 requestId 日志。

- [ ] **Step 4: 运行 SSE 测试**

Run: `pnpm exec tsx --test tests/sseEventWriter.test.ts tests/chatController.test.ts`

Expected: PASS，首个 delta 仍在模型完成前写出，错误与 done 的 SSE 格式不变。

### Task 4: 通过 AgentRunner 消除 application 对 LangGraph 的反向依赖

**Files:**
- Modify: `server/application/chat/chat.ports.ts`
- Modify: `server/application/chat/chat.service.ts`
- Create: `server/agent/langgraph-agent-runner.ts`
- Modify: `server/app.module.ts`
- Modify: `server/agent/graph.ts`
- Test: `tests/chatApplication.test.ts`
- Test: `tests/appComposition.test.ts`
- Test: `tests/architectureBoundary.test.ts`

- [ ] **Step 1: 写失败测试**

应用测试通过 fake `AgentRunner` 验证：`ChatApplicationService` 过滤客户端角色和构造可信 system messages 后，将 `goal`、消息、取消信号、IP、时间及 `onEvent` 传入 runner；服务本身没有 import `server/agent/graph`。组成根测试验证 `AGENT_RUNNER` 可解析并驱动真实 Graph。

- [ ] **Step 2: 运行 application/architecture 测试并确认红灯**

Run: `pnpm exec tsx --test tests/chatApplication.test.ts tests/appComposition.test.ts tests/architectureBoundary.test.ts`

Expected: FAIL，因为 service 目前直接创建 `createOnlineAgentGraph`。

- [ ] **Step 3: 定义端口与适配器**

在 `chat.ports.ts` 新增：

```ts
export const AGENT_RUNNER = Symbol('AGENT_RUNNER');
export interface AgentRunRequest {
  goal: string; messages: readonly ModelConversationMessage[]; signal: AbortSignal;
  ip: string; now: () => Date; onEvent?: (event: AgentSseEvent) => void;
}
export interface AgentRunner { run(request: AgentRunRequest): Promise<readonly AgentSseEvent[]>; }
```

将 `ModelConversationMessage` 与 `AgentSseEvent` 移至或以 type-only application/domain 公共模块导出，避免 ports 从 agent 导入。`LangGraphAgentRunner` 接收 model、tools、planner，构造一次 graph，`run()` 调用 graph 并返回 `state.events`。`ChatApplicationService` 接收 `AgentRunner`，不再定义 `graphFactory` 或导入 agent。`AppModule` 注册 `AGENT_RUNNER` 并将其注入 chat service。

- [ ] **Step 4: 运行边界测试**

Run: `pnpm exec tsx --test tests/chatApplication.test.ts tests/appComposition.test.ts tests/architectureBoundary.test.ts`

Expected: PASS，聊天行为、规划循环和替换端口测试保持通过，application 源码没有 agent/Nest/Express import。

### Task 5: 以 manifest 收敛工具注册并清理 legacy 编排

**Files:**
- Modify: `server/domain/tools/tool.types.ts`
- Modify: `server/tools/registry.ts`
- Modify: `server/infrastructure/tools/tool-registry.adapter.ts`
- Delete: `server/legacy/deepseek.ts`
- Delete: `server/legacy/market-search.handler.ts`
- Modify: `tests/toolRegistry.test.ts`
- Modify: `tests/toolRegistryAdapter.test.ts`
- Modify: `tests/architectureBoundary.test.ts`

- [ ] **Step 1: 写失败测试**

新增 manifest 测试，断言每个已发布工具都有非空 `version`、`riskLevel: 'read_only'`、有限 `timeoutMs`、闭合 schema 与执行器；definitions 与 execute 必须使用同一 manifest。对一个故意超时的执行器断言返回 `tool_execution_timeout`，且调用方取消仍返回 `request_aborted`。架构测试断言两个 legacy 文件不存在。

- [ ] **Step 2: 运行工具与架构测试并确认红灯**

Run: `pnpm exec tsx --test tests/toolRegistry.test.ts tests/toolRegistryAdapter.test.ts tests/architectureBoundary.test.ts`

Expected: FAIL，因为当前 contracts 与 execute 分散在条件分支，legacy 文件仍存在。

- [ ] **Step 3: 实现不可变 manifest 和工具时限**

在 domain 定义：

```ts
export interface ToolManifest {
  name: string; version: string; riskLevel: 'read_only'; timeoutMs: number;
  definition: ToolDefinition;
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

`createToolRegistry()` 创建固定 `readonly ToolManifest[]`；`definitions()` map manifest definition，`execute()` 按 name 找 manifest、先校验闭合 schema、以子 AbortController 限制 manifest timeout，再调用 manifest executor。将四个现有工具的正常化逻辑迁入各自 manifest execute 函数，保留原错误码、输出清洗和取消语义。禁止从模型输入或 HTTP 请求动态注册 manifest。

- [ ] **Step 4: 删除未使用 legacy 文件并运行目标测试**

删除两个 legacy 文件，更新 architecture test 使用 `access()` 断言其不存在。

Run: `pnpm exec tsx --test tests/toolRegistry.test.ts tests/toolRegistryAdapter.test.ts tests/architectureBoundary.test.ts`

Expected: PASS，四个工具定义顺序和参数 contract 不变，超时、取消和未知工具错误可预测，生产入口无旧编排。

### Task 6: 文档、全量回归和手工运行验证

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-22-full-framework-architecture-design.md`
- Modify: `docs/superpowers/specs/2026-08-11-stateless-production-hardening-design.md`（仅在实现迫使设计调整时）

- [ ] **Step 1: 更新运行文档**

更新 README 的健康接口、模型韧性配置、metrics、工具 manifest 与明确非目标，删除对固定 `{ "ok": true }` health 的过时描述。同步旧架构设计中的 `SseEventWriter`、`AgentRunner`、ready/metrics 与 legacy 清理状态。

- [ ] **Step 2: 运行针对性回归**

Run: `pnpm exec tsx --test tests/resilientModelClient.test.ts tests/healthController.test.ts tests/sseEventWriter.test.ts tests/chatApplication.test.ts tests/toolRegistry.test.ts`

Expected: PASS。

- [ ] **Step 3: 运行完整质量门禁**

Run: `pnpm typecheck && pnpm test && pnpm build && git diff --check`

Expected: 命令全部以状态码 0 结束；不通过关闭 strict、删除安全测试、`@ts-nocheck` 或降低工具 schema 约束来修复失败。

- [ ] **Step 4: 检查变更范围**

Run: `git status --short && git diff --stat`

Expected: 仅包含本计划的服务端、测试与文档变更；不引入数据库、认证、权限、限流、服务端记忆或跨设备会话。用户未要求本阶段自动提交，因此不创建提交。
