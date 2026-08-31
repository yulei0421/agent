# Agent 能力层增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入服务端持久化和外部副作用的前提下，为现有金融 Agent 增加统一能力清单、任务级模型路由、受限子 Agent、文档摘要校验、引用状态和临时任务运行时。

**Architecture:** 应用层通过 `CapabilityRegistry` 暴露只读能力元数据；`ModelRouter` 包装现有 `ModelClient` 并按固定任务类型选择客户端；LangGraph 使用 `SubAgentRegistry` 执行无工具、有限预算的协作角色；`TaskRuntime` 管理单进程任务状态并把任务、引用和进度转换为 SSE/HTTP 摘要。

**Tech Stack:** TypeScript strict、NestJS 11、React 19、LangGraph、Node 内置测试运行器、SSE。

---

### Task 1: 统一能力清单

**Files:**
- Create: `server/application/capabilities/capability.types.ts`
- Create: `server/application/capabilities/capability.registry.ts`
- Create: `server/api/capabilities/capabilities.controller.ts`
- Modify: `server/app.module.ts`
- Modify: `server/types.ts`
- Test: `tests/capabilityRegistry.test.ts`

- [x] 定义冻结的工具、子 Agent、模型能力 manifest 类型及固定风险级别。
- [x] 将当前六个工具和两个研究角色注册为服务端静态清单，提供脱敏公开摘要。
- [x] 增加 `GET /api/capabilities`，拒绝通过请求体动态注册能力。
- [x] 测试排序稳定、未知字段不泄漏、manifest 不可变和控制器响应。

### Task 2: 任务级模型路由

**Files:**
- Modify: `server/application/chat/chat.ports.ts`
- Create: `server/infrastructure/deepseek/model-router.ts`
- Modify: `server/infrastructure/config/app-config.service.ts`
- Modify: `server/app.module.ts`
- Modify: `server/application/chat/chat.service.ts`
- Modify: `server/api/chat/chat.controller.ts`
- Test: `tests/modelRouter.test.ts`

- [x] 扩展 `ModelRequest` 和聊天请求的固定 `taskType` 枚举。
- [x] 实现 `ModelRouter`：未配置专用客户端时回退默认客户端，禁止客户端传 URL/密钥/模型。
- [x] 为 `fast`、`reasoning`、`structured` 路由增加配置校验和单元测试。
- [x] 保持现有故障切换、取消和 `review` 兼容。

### Task 3: 受限子 Agent 注册表与预算

**Files:**
- Create: `server/agent/sub-agent-registry.ts`
- Modify: `server/agent/research-coordinator.ts`
- Modify: `server/agent/langgraph-agent-runner.ts`
- Modify: `server/types.ts`
- Test: `tests/subAgentRegistry.test.ts`

- [x] 定义固定角色、输出条数、超时和并发预算。
- [x] 并行运行角色并隔离失败；子 Agent 永远收到空工具定义。
- [x] 将角色元数据和预算消耗作为安全 `agent` SSE 事件，不泄漏原始提示词。
- [x] 验证单角色超时、取消、重复角色和超预算行为。

### Task 4: 文档摘要与引用账本增强

**Files:**
- Modify: `server/application/chat/chat.service.ts`
- Modify: `server/api/chat/chat.controller.ts`
- Modify: `shared/research-citations.ts`
- Modify: `src/lib/attachments.ts`
- Modify: `src/lib/chat.ts`
- Modify: `src/types.ts`
- Test: `tests/documentInput.test.ts`
- Test: `tests/researchCitations.test.ts`

- [x] 定义 `{name, mimeType, text}` 文档摘要契约和服务端二次校验。
- [x] 限制 MIME、名称、字符数和危险 URL/IP/控制字符；非文本和超限输入受控失败。
- [x] 为引用增加来源标签、观测时间、新鲜度和过期状态，并保持未知引用拒绝。
- [x] 前端保留本地读取，不上传原始二进制和独立文件存储。

### Task 5: 临时任务运行时与 API

**Files:**
- Create: `server/application/tasks/task-runtime.ts`
- Create: `server/api/tasks/task.controller.ts`
- Modify: `server/api/chat/chat.controller.ts`
- Modify: `server/types.ts`
- Modify: `src/lib/chat.ts`
- Modify: `src/types.ts`
- Test: `tests/taskRuntime.test.ts`
- Test: `tests/taskController.test.ts`

- [x] 实现内存任务状态、随机令牌、TTL、状态摘要和幂等取消。
- [x] 聊天 SSE 首次发送 `task` 事件，断开时传播 `AbortSignal` 并标记取消。
- [x] 增加 `GET /api/tasks/:id` 与 `POST /api/tasks/:id/cancel`，只返回固定状态和计数。
- [x] 前端保存任务 ID，并在停止生成时调用取消接口；过期/重启不伪造后台完成。

### Task 6: 集成验证与文档

**Files:**
- Modify: `README.md`
- Modify: `docs/agent-capability-gap-analysis.md`
- Test: `tests/chatController.test.ts`
- Test: `tests/chatApplication.test.ts`

- [x] 更新 API、能力矩阵、无状态限制和配置说明。
- [x] 运行类型检查、完整测试（必要时使用 `node --import tsx` 绕过沙箱 IPC 限制）、构建和 diff 检查。
- [x] 检查取消、过期、模型回退、工具循环、导出和旧 UI 行为未回归。

### Task 7: 本地上下文智能

**Files:**
- Modify: `src/lib/history.ts`
- Modify: `src/lib/attachments.ts`
- Modify: `src/types.ts`
- Modify: `src/App.tsx`
- Test: `tests/history.test.ts`
- Test: `tests/attachments.test.ts`

- [x] 为本地会话生成有上限的工作记忆，并在模型历史预算中保留参考消息。
- [x] 对历史文本附件做固定窗口分片、词法排序、去重和字符上限控制。
- [x] 在聊天请求前召回相关附件片段，成功回答后把记忆写回当前浏览器会话。
- [x] 验证新会话、离线重试、空查询、重复附件和历史消息行为。

### Task 8: 能力清单前端展示

**Files:**
- Create: `src/lib/capabilities.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/styles.css`
- Test: `tests/capabilitiesUi.test.ts`

- [x] 校验 `GET /api/capabilities` 的公开字段并冻结客户端结果，拒绝执行器字段和畸形响应。
- [x] 在侧栏展示工具、子 Agent 和模型类别；能力接口失败不阻塞应用启动或聊天。
- [x] 覆盖公开字段校验、冻结结果、UI 展示和无执行器泄漏测试。

### Task 9: PDF/图片 OCR 与请求级向量召回（后续扩展）

**Files:**
- Create: `server/api/documents/documents.controller.ts`
- Create: `server/application/documents/document-ingestion.service.ts`
- Create: `server/infrastructure/documents/document-extractor.ts`
- Create: `server/application/chat/document-retrieval.ts`
- Modify: `server/application/chat/chat.service.ts`
- Modify: `src/lib/attachments.ts`
- Modify: `src/components/ChatWindow.tsx`

- [x] 校验 PDF/PNG/JPG/WEBP 的扩展名、MIME、base64、magic bytes 和 8 MB 大小上限。
- [x] 使用 PDF.js 提取文本层；无文本层时渲染最多 8 页并交给 Tesseract.js OCR，图片直接 OCR。
- [x] 将抽取文本裁剪为受限摘要和分块，原始二进制只在请求内存中处理；OCR 失败返回公共错误码。
- [x] 在服务端构造 token-count 向量并按 cosine similarity 做请求级文档召回，最多四个文档、每个文档 3500 字符，不建立持久索引。
- [x] 将二进制附件解析结果保存到当前消息并接入现有 LangGraph 聊天上下文，补充依赖、配置、测试和 README。
