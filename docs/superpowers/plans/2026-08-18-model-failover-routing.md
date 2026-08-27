# 多模型健康故障切换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在不改变默认 DeepSeek 行为的前提下，为模型流增加可配置的备用 OpenAI 兼容端点，并且只在主模型产生任何可见输出前失败时切换。

**架构：** 保留现有 `ResilientModelClient` 负责单个模型的重试、超时和熔断；新增一个无状态 `FailoverModelClient` 负责主/备模型选择。它只在主模型尚未产生事件时切换，避免将两个模型的半截回答拼接到同一个 SSE 流中。备用模型完全由环境变量显式配置，未配置时保持现有行为。

**技术栈：** TypeScript、NestJS、DeepSeek OpenAI 兼容 SSE、Node Test Runner、现有运行时遥测。

---

### 任务 1：为故障切换行为写失败测试

**文件：**

- 创建：`server/infrastructure/deepseek/failover-model-client.ts`
- 修改：`tests/deepSeekClient.test.ts`
- 修改：`tests/chatRuntime.test.ts`

- [x] **步骤 1：写主模型无输出失败后切备用模型的测试**

测试使用两个假的 `ModelClient`：主模型先抛出 `model_unavailable`，备用模型输出 `delta` 和 `done`；断言只收到备用模型事件。

- [x] **步骤 2：写主模型已经输出后不切换的测试**

主模型先输出一个 `delta` 再失败；断言迭代器抛出错误，备用模型没有被调用。

- [x] **步骤 3：写请求取消不切换的测试**

父级 `AbortSignal` 已取消时，断言直接抛出 `request_aborted`，备用模型没有被调用。

- [x] **步骤 4：运行定向测试确认按预期失败**

运行：

```bash
pnpm exec tsx --test tests/deepSeekClient.test.ts tests/chatRuntime.test.ts
```

预期：新增故障切换测试因 `FailoverModelClient` 尚未实现而失败，其余现有测试保持通过。

### 任务 2：实现最小故障切换客户端

**文件：**

- 创建：`server/infrastructure/deepseek/failover-model-client.ts`

- [x] **步骤 1：实现事件级切换**

客户端保存 `hasYielded` 标志；主模型迭代期间如果没有产生任何事件就失败，则迭代备用模型；一旦产生任意事件，后续错误直接向上抛出。取消错误永远不触发切换。

- [x] **步骤 2：运行定向测试确认通过**

运行：

```bash
pnpm exec tsx --test tests/deepSeekClient.test.ts tests/chatRuntime.test.ts
```

预期：所有定向测试通过。

### 任务 3：接入 Nest 配置与组合根

**文件：**

- 修改：`server/infrastructure/config/app-config.service.ts`
- 修改：`server/app.module.ts`
- 修改：`.env.example`
- 修改：`tests/config.test.ts`
- 修改：`tests/chatRuntime.test.ts`

- [x] **步骤 1：增加可选备用模型配置**

增加 `MODEL_FALLBACK_API_KEY`、`MODEL_FALLBACK_BASE_URL`、`MODEL_FALLBACK_NAME`。只有三个值同时存在时才创建备用客户端；部分配置直接视为无备用模型并记录配置错误，不把密钥写入日志或响应。

- [x] **步骤 2：在组合根中包装主/备用 ResilientModelClient**

主模型和备用模型分别使用独立的重试/熔断实例，再由 `FailoverModelClient` 组合。未配置备用模型时注入主模型实例，保持现有 `model_unavailable` 行为。

- [x] **步骤 3：为配置边界补测试**

覆盖默认无备用模型、完整配置启用备用模型、只配置部分字段被拒绝或忽略，以及备用端点必须是绝对 HTTP(S) origin。

### 任务 4：增加遥测与文档

**文件：**

- 修改：`server/infrastructure/runtime/runtime-telemetry.ts`
- 修改：`server/api/health/metrics.controller.ts`
- 修改：`README.md`
- 修改：`docs/agent-capability-gap-analysis.md`

- [x] **步骤 1：记录备用切换次数**

新增进程内计数器和 Prometheus 文本指标 `agent_model_failover_total`；不记录模型密钥、提示词或用户内容。

- [x] **步骤 2：补充运行说明**

文档说明备用模型仅在主模型零输出失败时启用、流中途失败不会拼接、取消不会切换、未配置时行为不变。

### 任务 5：全量验证

**文件：** 无新增

- [x] **步骤 1：运行类型检查和全量测试**

```bash
pnpm typecheck
pnpm test
```

- [x] **步骤 2：运行构建和差异检查**

```bash
pnpm build
pnpm test:smoke
git diff --check
```
