# Agent 研究能力与运行治理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为无状态金融 Agent 增加只读研究工具、可靠决策、结构化输出与可验证运行治理。

**Architecture:** 固定 ToolManifest 承载公开数据工具；LangGraph 评估安全摘要并并行执行独立调用；金融模式使用服务端输出契约和浏览器严格 JSON 解析；遥测在工具端口外进行聚合。

**Tech Stack:** TypeScript strict、NestJS、LangGraph、React、Node test runner、GitHub Actions。

---

### Task 1: 新增公开只读研究工具

**Files:** `server/economic-calendar/gateway.ts`、`server/tools/registry.ts`、`server/app.module.ts`、`tests/economicCalendarGateway.test.ts`、`tests/toolRegistry.test.ts`

- [x] 定义固定经济日历源、超时、取消和字段净化的失败测试。
- [x] 实现 `get_economic_calendar` 与 `get_technical_indicators`，以 manifest schema、子取消信号与统一时限执行。
- [x] 将日历适配器接入 Nest 组成根，并验证工具、市场和日历测试。

### Task 2: 提升 Agent 工具决策

**Files:** `server/agent/state.ts`、`server/agent/graph.ts`、`tests/agentGraph.test.ts`

- [x] 写入并行调用、模型顺序、连续失败和陈旧结果的回归测试。
- [x] 并行启动同轮合法调用，顺序写入 SSE 与模型 tool messages。
- [x] 记录无内容的执行摘要，并在连续失败或无用陈旧结果时强制最终回答。

### Task 3: 输出结构化研究报告

**Files:** `server/application/chat/chat.service.ts`、`server/api/chat/chat.controller.ts`、`src/lib/research-report.ts`、`src/App.tsx`、`src/components/MessageItem.tsx`、`tests/researchReport.test.ts`

- [x] 写入严格 JSON 解析、原型与长度限制测试。
- [x] 仅对验证过的金融上下文注入服务端 JSON 输出契约。
- [x] 将合格报告渲染为结论、依据、风险和数据时间卡片，非法输出降级为 Markdown。

### Task 4: 运行指标、CI 与性能基线

**Files:** `server/infrastructure/runtime/runtime-telemetry.ts`、`server/infrastructure/runtime/instrumented-tool-executor.ts`、`.github/workflows/ci.yml`、`tests/runtimeTelemetry.test.ts`、`tests/performanceBaseline.test.ts`、`scripts/smoke.ts`

- [x] 为固定工具、来源、新鲜度和延迟桶添加安全聚合指标。
- [x] 用工具执行器包装器接入生产组成根。
- [x] 添加 CI、无网络性能基线与显式 opt-in smoke 检查。

### Task 5: 全量验收

- [x] 运行 `pnpm typecheck && pnpm test && pnpm build && git diff --check`。
- [x] 审阅变更范围、更新 README 与架构说明；变更保留在当前工作区，等待用户明确要求后再提交。
