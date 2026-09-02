# 生产级 Agent 能力补齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入服务端聊天记忆和跨设备会话的前提下，补齐文档安全解析、动态子 Agent、可验证引用、多模型路由、后台任务与受控浏览器操作六类生产能力。

**Architecture:** 各能力以独立 application/infrastructure 服务实现，通过现有 NestJS controller、LangGraph runner 和 ToolManifest 接入。所有外部输入先经过 schema、大小、权限和超时校验；任务状态与事件采用可替换存储接口，默认内存实现，避免把任务存储误作聊天记忆。

**Tech Stack:** TypeScript、NestJS、LangGraph、PDF.js、Tesseract.js、Playwright（受限执行器）、现有 SSE/WebSocket、Node test runner。

---

### Task 1: 文档安全与检索增强

**Files:**
- Create: `server/application/documents/document-security.service.ts`
- Modify: `server/application/documents/document-ingestion.service.ts`
- Modify: `server/infrastructure/documents/document-extractor.ts`
- Modify: `server/api/documents/documents.controller.ts`
- Test: `tests/documentSecurity.test.ts`

- [ ] 增加病毒扫描抽象、加密 PDF 拒绝、上传配额/审计字段与真实 embedding provider 接口。
- [ ] 为恶意类型、超额、加密 PDF、正常文件分别写失败/成功测试。
- [ ] 接入 ingest 流程并保持现有 MIME、magic bytes、页数和大小限制。

### Task 2: 动态子 Agent 与预算

**Files:**
- Create: `server/agent/budget-manager.ts`
- Modify: `server/agent/sub-agent-registry.ts`
- Modify: `server/agent/research-coordinator.ts`
- Modify: `server/agent/langgraph-agent-runner.ts`
- Test: `tests/dynamicSubAgents.test.ts`

- [ ] 定义可动态规划的角色、依赖、并发、token/费用/时间预算。
- [ ] 支持模型输出受 schema 约束的子任务计划，并在服务端裁剪超预算计划。
- [ ] 实现失败隔离、取消传播、结果合并与预算遥测。

### Task 3: 引用代理与 provenance

**Files:**
- Create: `server/application/citations/citation-proxy.service.ts`
- Create: `server/api/citations/citations.controller.ts`
- Modify: `shared/research-citations.ts`
- Modify: `server/infrastructure/runtime/instrumented-tool-executor.ts`
- Test: `tests/citationProxy.test.ts`

- [ ] 为每个引用保存来源快照、内容 hash、抓取时间和原始工具响应关联。
- [ ] 提供受控的引用详情/重新验证接口，禁止直接暴露未审计 URL。
- [ ] 增加过期状态、重抓取和签名校验测试。

### Task 4: 成本/能力/健康度模型路由

**Files:**
- Modify: `server/infrastructure/deepseek/model-router.ts`
- Create: `server/infrastructure/deepseek/model-registry.ts`
- Modify: `server/infrastructure/deepseek/resilient-model-client.ts`
- Modify: `server/infrastructure/deepseek/failover-model-client.ts`
- Test: `tests/modelRoutingPolicy.test.ts`

- [ ] 注册模型能力、价格、延迟和健康度指标。
- [ ] 根据任务能力、结构化要求、剩余预算和健康度动态打分。
- [ ] 记录 token 用量和估算费用，超预算时降级或拒绝。

### Task 5: 后台任务、取消、重试与通知

**Files:**
- Create: `server/application/tasks/task-store.ts`
- Create: `server/application/tasks/task-notification.service.ts`
- Modify: `server/application/tasks/task-runtime.ts`
- Modify: `server/api/tasks/task.controller.ts`
- Test: `tests/backgroundTasks.test.ts`

- [ ] 将任务执行与 SSE 生命周期解耦，断开后继续执行并支持事件回放。
- [ ] 增加幂等键、指数退避、可配置重试和任务进度。
- [ ] 提供站内通知/Webhook 抽象，默认内存实现，不持久化聊天记忆。

### Task 6: 浏览器沙箱与人工确认

**Files:**
- Create: `server/browser/browser-policy.ts`
- Create: `server/browser/browser-executor.ts`
- Create: `server/api/browser/browser.controller.ts`
- Modify: `server/app.module.ts`
- Modify: `server/agent/approval-coordinator.ts`
- Test: `tests/browserSecurity.test.ts`

- [ ] 仅支持导航、点击、提取文本和截图四类动作，采用域名白名单、资源/时长限制。
- [ ] 使用 Playwright 隔离上下文，阻止下载、文件访问、跨域跳转和任意脚本执行。
- [ ] 对写操作和非白名单域名强制人工确认，记录审计事件和可回放快照。

### Task 7: 全量验证与文档

**Files:**
- Modify: `README.md`
- Create: `docs/production-capabilities.md`

- [ ] 运行专项测试、`pnpm typecheck`、`pnpm build`、`pnpm test`、`git diff --check`。
- [ ] 更新环境变量、接口、威胁模型和已知限制说明。
