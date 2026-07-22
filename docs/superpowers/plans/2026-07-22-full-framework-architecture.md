# 全量框架化架构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Express 单体服务端迁移为 API 兼容、可观测且由 LangGraph 驱动在线 Agent 循环的 NestJS 分层应用。

**Architecture:** NestJS 作为唯一 HTTP/WebSocket 宿主；控制器仅负责 DTO 和传输协议，应用服务承担用例，领域层声明端口、DTO 与错误码，基础设施层实现 DeepSeek 和受控数据工具。在线聊天由 LangGraph 编排规划、模型、工具与最终化节点，SSE 事件由单一写入器输出。

**Tech Stack:** Node.js、TypeScript strict、NestJS、@nestjs/config、@nestjs/websockets、ws、@langchain/langgraph、React/Vite、Node test runner。

---

## 目标文件结构

- Create: `server/main.ts`、`server/app.module.ts`
- Create: `server/api/chat/chat.controller.ts`、`server/api/chat/chat.dto.ts`、`server/api/chat/sse-event-writer.ts`
- Create: `server/api/market/market.controller.ts`、`server/api/health/health.controller.ts`、`server/api/realtime/realtime.gateway.ts`
- Create: `server/application/chat/chat.service.ts`、`server/application/chat/chat.ports.ts`、`server/application/market/market-search.service.ts`
- Create: `server/domain/chat/messages.ts`、`server/domain/errors/app-error.ts`、`server/domain/tools/tool.types.ts`
- Create: `server/infrastructure/config/app-config.module.ts`、`server/infrastructure/config/app-config.service.ts`、`server/infrastructure/logging/app-logger.service.ts`
- Create: `server/infrastructure/deepseek/deepseek-client.ts`、`server/infrastructure/tools/tool-registry.adapter.ts`
- Modify: `server/agent/state.ts`、`server/agent/graph.ts`
- Modify: `package.json`、`tsconfig.json`、`.env.example`、`README.md`
- Move/remove after migration: `server/index.ts`、`server/deepseek.ts`、`server/websocket.ts`、`server/market/search-api.ts`
- Test: `tests/nest-chat.test.ts`、`tests/agentGraph.test.ts`、`tests/config.test.ts`、现有行为测试

### Task 1: 引入 NestJS 宿主与配置模块

**Files:**
- Modify: `package.json`
- Create: `server/main.ts`
- Create: `server/app.module.ts`
- Create: `server/infrastructure/config/app-config.module.ts`
- Create: `server/infrastructure/config/app-config.service.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: 写出配置校验失败的测试**

```ts
test('rejects an invalid port and unsafe client URL', () => {
  assert.throws(() => parseAppConfig({ PORT: 'zero', CLIENT_URL: 'not-a-url' }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/config.test.ts`

Expected: FAIL，`parseAppConfig` 尚不存在。

- [ ] **Step 3: 安装 Nest 依赖并替换启动脚本**

```json
{
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/websockets": "^11.0.0"
  },
  "scripts": { "server": "tsx server/main.ts", "dev": "concurrently \"tsx watch server/main.ts\" \"vite --host 127.0.0.1\"" }
}
```

- [ ] **Step 4: 实现配置服务和 Nest 根模块**

`parseAppConfig` 必须校验端口范围、`CLIENT_URL` 的 HTTP(S) 来源、`TRUST_PROXY` 布尔值与非占位 DeepSeek Key；`main.ts` 配置 JSON body 上限、CORS、全局请求 ID 中间件并监听 `127.0.0.1`。

- [ ] **Step 5: 运行配置测试、构建与提交**

Run: `pnpm test -- tests/config.test.ts && pnpm build`

Expected: PASS。

### Task 2: 定义领域模型、应用端口与统一错误

**Files:**
- Create: `server/domain/chat/messages.ts`
- Create: `server/domain/errors/app-error.ts`
- Create: `server/domain/tools/tool.types.ts`
- Create: `server/application/chat/chat.ports.ts`
- Create: `server/infrastructure/logging/app-logger.service.ts`
- Test: `tests/domainContracts.test.ts`

- [ ] **Step 1: 写出错误映射与消息过滤测试**

```ts
assert.deepEqual(filterClientMessages([{ role: 'system', content: 'inject' }]), []);
assert.equal(toPublicError(new AppError('request_aborted')).status, 499);
```

- [ ] **Step 2: 实现纯领域类型和错误码**

定义 `ChatMessage`、`ToolCall`、`ToolResult`、`AgentSseEvent`、`AppErrorCode`；将可复用的客户端消息过滤、金融上下文校验、工具轮次常量迁出 HTTP 层。

- [ ] **Step 3: 声明应用端口**

```ts
export const MODEL_CLIENT = Symbol('MODEL_CLIENT');
export interface ModelClient { stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>; }
export const TOOL_EXECUTOR = Symbol('TOOL_EXECUTOR');
```

- [ ] **Step 4: 实现不会泄漏敏感字段的结构化日志**

日志字段仅允许 `requestId`、事件名、工具名、错误码、持续时间；禁止记录 API Key、完整消息、URL、IP 与未清洗工具响应。

- [ ] **Step 5: 运行领域测试与提交**

Run: `pnpm test -- tests/domainContracts.test.ts`

Expected: PASS。

### Task 3: 迁移基础设施适配器与市场搜索用例

**Files:**
- Create: `server/infrastructure/deepseek/deepseek-client.ts`
- Create: `server/infrastructure/tools/tool-registry.adapter.ts`
- Create: `server/application/market/market-search.service.ts`
- Create: `server/api/market/market.controller.ts`
- Modify: `server/tools/registry.ts`、`server/market/search.ts`
- Test: `tests/marketSearchController.test.ts`、`tests/toolRegistry.test.ts`

- [ ] **Step 1: 写市场搜索控制器兼容测试**

```ts
await request(app.getHttpServer()).get('/api/market/search?q=AAPL').expect(200, {
  results: [{ symbol: 'AAPL', name: 'Apple', market: 'us', type: 'stock', source: 'local-index' }]
});
```

- [ ] **Step 2: 将 DeepSeek 请求和 SSE 解析封装为 `ModelClient`**

适配器必须只接受服务端配置，发送已有的模型请求体，解析分块 SSE，并在 AbortSignal 中止时停止上游读取。

- [ ] **Step 3: 将现有受控工具注册表作为 `ToolExecutor` 适配器绑定**

保留四个工具、字段闭合 schema、结果清洗、固定数据源、请求取消和原错误码。

- [ ] **Step 4: 通过应用服务暴露市场搜索**

控制器只校验 `q` 长度、创建取消信号并返回 `{ results }` 或 499；不得直接调用供应商。

- [ ] **Step 5: 运行市场及工具测试与提交**

Run: `pnpm test -- tests/assetSearch.test.ts tests/toolRegistry.test.ts tests/marketSearchController.test.ts`

Expected: PASS。

### Task 4: 实现 LangGraph 在线 Agent 图

**Files:**
- Modify: `server/agent/state.ts`
- Modify: `server/agent/graph.ts`
- Create: `server/application/chat/chat.service.ts`
- Test: `tests/agentGraph.test.ts`、`tests/chatApplication.test.ts`

- [ ] **Step 1: 写图路由测试**

```ts
const output = await graph.invoke({ messages: [userMessage], toolRounds: 0, toolCalls: 0 });
assert.equal(output.finalized, true);
assert.deepEqual(events.map((event) => event.type), ['tool', 'tool_result', 'delta', 'done']);
```

- [ ] **Step 2: 扩充图状态**

状态必须含 `messages`、`plan`、`pendingCalls`、`toolRounds`、`toolCalls`、`forceFinalAnswer`、`finalized`、`events` 和取消信号；计划最多三步且不进入模型提示词或 SSE。

- [ ] **Step 3: 实现五个节点与条件边**

`plan_request` 规范化计划；`model_agent` 增量写入模型事件；`execute_tools` 校验并执行；`evaluate_next` 在无调用、超限或无效调用时选择终态；`finalize` 只写一次 `done`。

- [ ] **Step 4: 将工具限制和注入防护迁移入图节点**

保留 3 轮/6 次限制、无效调用提示、`tool_limit_reached`、工具输出不可信系统指令与客户端 `system/tool` 消息过滤。

- [ ] **Step 5: 运行 Agent 与聊天应用测试并提交**

Run: `pnpm test -- tests/agentGraph.test.ts tests/chatApplication.test.ts tests/deepseek.test.ts`

Expected: PASS，原流式工具多轮行为不变。

### Task 5: 添加 Nest API/SSE/WebSocket 适配层

**Files:**
- Create: `server/api/chat/chat.controller.ts`
- Create: `server/api/chat/chat.dto.ts`
- Create: `server/api/chat/sse-event-writer.ts`
- Create: `server/api/health/health.controller.ts`
- Create: `server/api/realtime/realtime.gateway.ts`
- Test: `tests/nest-chat.test.ts`、`tests/realtimeGateway.test.ts`

- [ ] **Step 1: 写 SSE 契约测试**

```ts
assert.deepEqual(parseSse(response.text), [
  { type: 'delta', content: '最终回答' },
  { type: 'done' }
]);
```

- [ ] **Step 2: 实现 `SseEventWriter` 与聊天控制器**

控制器必须设置原有 SSE 头、建立与 `req.close` 关联的 AbortController、委托 `ChatApplicationService`，并只从领域事件序列化现有事件格式。

- [ ] **Step 3: 实现健康控制器和 WebSocket Gateway**

健康接口继续返回 `{ ok: true }`；Gateway 保持 `/ws`、首次 `status`、`ping -> pong` 与 15 秒 `notice`，并在模块销毁时清理定时器。

- [ ] **Step 4: 运行 HTTP 与实时通信兼容测试**

Run: `pnpm test -- tests/nest-chat.test.ts tests/realtimeGateway.test.ts tests/deepseek.test.ts`

Expected: PASS。

### Task 6: 移除旧宿主、完成类型收敛和交付文档

**Files:**
- Delete: `server/index.ts`、`server/deepseek.ts`、`server/websocket.ts`、`server/market/search-api.ts`
- Modify: `tsconfig.json`、`README.md`、`.env.example`
- Modify: 所有 `tests/*.test.ts` 的隐式 any 与不安全 mock

- [ ] **Step 1: 删除已迁移的 Express 入口并更新导入**

在所有 Nest 兼容测试通过后删除旧宿主；不得保留两个生产启动入口或 Express 运行依赖。

- [ ] **Step 2: 将 TypeScript 检查扩展到前端与测试**

```json
{ "include": ["server/**/*.ts", "src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts"] }
```

为测试 mock 标注最小接口，不降低 `strict`、`noUncheckedIndexedAccess` 或用 `@ts-nocheck`。

- [ ] **Step 3: 更新运行与架构文档**

README 说明 Nest 启动方式、模块层级、LangGraph 在线编排、健康检查、环境变量和不支持交易执行的边界。

- [ ] **Step 4: 完整验证**

Run: `pnpm typecheck && pnpm test && pnpm build`

Expected: 三项全部成功。

- [ ] **Step 5: 提交交付**

```bash
git add package.json pnpm-lock.yaml server src tests README.md .env.example tsconfig.json
git commit -m "refactor: migrate agent server to nest architecture"
```

## 计划自检

- 设计中的 Nest 宿主、四层依赖方向、LangGraph 在线图、配置/日志/错误、API 兼容与测试门禁分别由任务 1 至 6 覆盖。
- 计划不包含占位任务；每个改动均给出目标文件、测试路径和验证命令。
- 新旧入口的切换安排在兼容测试之后，避免迁移期间中断现有前端协议。
