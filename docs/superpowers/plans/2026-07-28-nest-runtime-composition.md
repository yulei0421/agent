# Nest 运行时组成根收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Nest 成为唯一服务端运行时，并让在线 LangGraph Agent 经由受控 API 层对外提供 SSE 服务。

**Architecture:** API 控制器负责 HTTP/SSE 协议与取消；`ChatApplicationService` 编排 Agent；基础设施适配器实现模型、工具和市场端口。旧 Express 文件仅在迁移期保持不可执行的兼容导出。

**Tech Stack:** TypeScript、NestJS 11、LangGraph、Express adapter、SSE、WebSocket、Node test runner。

---

### Task 1: 建立聊天 API 适配器

**Files:**
- Create: `server/api/chat/chat.controller.ts`
- Test: `tests/chatController.test.ts`

- [ ] 控制器将请求体、IP、关闭事件转换为 `ChatApplicationService.run` 输入，并按既有 SSE 合同输出事件。
- [ ] 连接关闭时中止 `AbortController`，结束后移除事件监听。
- [ ] 映射 `AppError` 为稳定 HTTP 状态与错误 SSE。

### Task 2: 收敛 Nest 依赖组成根

**Files:**
- Modify: `server/app.module.ts`
- Modify: `server/infrastructure/config/app-config.service.ts`
- Modify: `server/application/chat/chat.service.ts`
- Test: `tests/appComposition.test.ts`

- [ ] 由 `AppModule` 组装配置、模型客户端、工具执行器、市场搜索和聊天服务。
- [ ] 生产配置从 `AppConfigService` 读取，不在 provider 中直接读取 `process.env`。
- [ ] 测试证明替换端口实现不会让应用层依赖 Nest 或 HTTP。

### Task 3: 收敛服务启动与 WebSocket

**Files:**
- Modify: `package.json`
- Modify: `server/main.ts`
- Modify: `server/websocket.ts`
- Delete: `server/index.ts`
- Test: `tests/runtimeEntry.test.ts`

- [ ] `server` 脚本启动 `main.ts`。
- [ ] WebSocket 挂载到 Nest HTTP adapter，并在应用关闭时释放资源。
- [ ] 旧 `index.ts` 不得创建监听器或成为生产入口。

### Task 4: 删除旧聊天编排旁路并更新文档

**Files:**
- Move: `server/deepseek.ts` to `server/legacy/deepseek.ts`
- Modify: `README.md`
- Test: `tests/architectureBoundary.test.ts`

- [ ] 旧的 DeepSeek 工具循环不参与生产请求。
- [ ] README 与实际启动、依赖关系和 LangGraph 状态一致。
- [ ] 架构测试约束 API -> application -> domain <- infrastructure 的依赖方向。

### Task 5: 全量验证

**Files:**
- Test: `tests/*.test.ts`

- [ ] 执行类型检查、完整测试和前端构建。
- [ ] 使用 Nest 实例验证健康检查、市场搜索、聊天 SSE 与取消路径。
