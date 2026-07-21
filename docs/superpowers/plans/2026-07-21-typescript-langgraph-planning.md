# TypeScript 与 LangGraph 规划编排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将应用全量迁移为 TypeScript/TSX，并以 Node.js LangGraph 实现目标规划、工具回路和最终回答的受控 Graph。

**Architecture:** `server/agent/graph.ts` 使用 `StateGraph` 保存单请求目标、计划、消息、工具结果与调用计数；它继续调用现有受控工具注册表。`server/deepseek.ts` 退化为 HTTP/SSE 适配入口，只负责建立可信上下文、创建 Graph、流式输出和取消。

**Tech Stack:** TypeScript strict、TSX、Vite、Express、`tsx`、`@langchain/langgraph`、Node test runner。

---

### Task 1: 建立 TypeScript 工具链与共享类型

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `server/types.ts`
- Create: `tests/types.test.ts`

- [ ] **Step 1: 写入失败测试，约束共享 SSE 与工具结果类型可由 TypeScript 编译使用**

```ts
import type { AgentSseEvent, ToolExecutionResult } from '../server/types.js';

const event: AgentSseEvent = { type: 'tool_result', name: 'get_weather', ok: true, result: {} };
const result: ToolExecutionResult = { ok: false, name: 'get_weather', errorCode: 'request_aborted' };
void event;
void result;
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec tsx --test tests/types.test.ts`

Expected: FAIL，因为 `server/types.ts` 与 `tsx` 尚不存在。

- [ ] **Step 3: 安装 TypeScript 与 LangGraph 运行依赖，建立严格配置和类型边界**

```json
{
  "scripts": {
    "dev": "concurrently \"tsx watch server/index.ts\" \"vite --host 127.0.0.1\"",
    "server": "tsx server/index.ts",
    "test": "tsx --test tests/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@langchain/langgraph": "^0.2.0" },
  "devDependencies": { "@types/express": "^5.0.0", "@types/node": "^22.0.0", "tsx": "^4.0.0", "typescript": "^5.0.0" }
}
```

```ts
export type ToolExecutionResult =
  | { ok: true; name: string; result: Record<string, unknown> | unknown[] }
  | { ok: false; name: string; errorCode: string };

export type AgentSseEvent =
  | { type: 'delta' | 'reasoning'; content: string }
  | { type: 'tool'; id?: string; name: string }
  | ({ type: 'tool_result'; id?: string; name: string } & ToolExecutionResult)
  | { type: 'error'; message: string; detail?: string }
  | { type: 'done' };
```

`tsconfig.json` 必须使用 `strict`、`noUncheckedIndexedAccess`、`module`/`moduleResolution: "NodeNext"`、`jsx: "react-jsx"` 和 `allowJs: false`。

- [ ] **Step 4: 运行类型与测试确认通过**

Run: `pnpm typecheck && pnpm exec tsx --test tests/types.test.ts`

Expected: PASS。

### Task 2: 迁移基础服务、工具层与测试为 TypeScript

**Files:**
- Rename: `server/env.js` to `server/env.ts`
- Rename: `server/sse.js` to `server/sse.ts`
- Rename: `server/websocket.js` to `server/websocket.ts`
- Rename: `server/tools/live.js` to `server/tools/live.ts`
- Rename: `server/tools/web.js` to `server/tools/web.ts`
- Rename: `server/tools/registry.js` to `server/tools/registry.ts`
- Rename: `server/tools/market.js` to `server/tools/market.ts`
- Rename: `server/market/config.js` to `server/market/config.ts`
- Rename: `server/market/symbols.js` to `server/market/symbols.ts`
- Rename: `server/market/gateway.js` to `server/market/gateway.ts`
- Rename: `server/market/search.js` to `server/market/search.ts`
- Rename: `server/market/search-api.js` to `server/market/search-api.ts`
- Rename: `server/market/providers/binance.js` to `server/market/providers/binance.ts`
- Rename: `server/market/providers/eastmoney.js` to `server/market/providers/eastmoney.ts`
- Rename: `server/market/providers/tencent.js` to `server/market/providers/tencent.ts`
- Rename: `server/market/providers/yahoo.js` to `server/market/providers/yahoo.ts`
- Rename: `tests/assetSearch.test.js`, `tests/liveContext.test.js`, `tests/marketGateway.test.js`, `tests/marketSymbols.test.js`, `tests/marketTools.test.js`, `tests/sse.test.js`, `tests/toolRegistry.test.js`, `tests/webSearch.test.js` to `.test.ts`

- [ ] **Step 1: 将底层工具回归测试改为 TypeScript，并保留取消、固定来源和结果规范化断言**

```ts
const response = await registry.execute(
  { name: 'get_quote', arguments: '{"symbol":"AAPL"}' },
  { signal: new AbortController().signal }
);
assert.equal(response.ok, true);
```

- [ ] **Step 2: 运行迁移后的底层测试确认失败**

Run: `pnpm exec tsx --test tests/{assetSearch,liveContext,marketGateway,marketSymbols,marketTools,sse,toolRegistry,webSearch}.test.ts`

Expected: FAIL，直到所有导入、Node/Express 类型和 fetch 响应类型完成迁移。

- [ ] **Step 3: 迁移实现，显式标注网络、工具与行情边界**

```ts
export interface ToolRegistry {
  definitions(): readonly ToolDefinition[];
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export interface ToolExecutionContext {
  ip?: string;
  now?: () => Date;
  signal?: AbortSignal;
}
```

所有相对导入必须更新为 `.js` 运行时后缀；不使用 `any`，对未知响应先用 `unknown` 再验证。保留固定域名、超时、请求取消、共享行情消费者和工具结果净化。

- [ ] **Step 4: 运行基础服务回归与类型检查**

Run: `pnpm typecheck && pnpm exec tsx --test tests/{assetSearch,liveContext,marketGateway,marketSymbols,marketTools,sse,toolRegistry,webSearch}.test.ts`

Expected: PASS。

### Task 3: 建立 LangGraph 状态与规划节点

**Files:**
- Create: `server/agent/state.ts`
- Create: `server/agent/planner.ts`
- Create: `server/agent/graph.ts`
- Create: `tests/agentGraph.test.ts`
- Rename: `server/deepseek.js` to `server/deepseek.ts`

- [ ] **Step 1: 写入失败测试，约束规划与状态上限**

```ts
const state = await runAgentGraph({
  messages: [{ role: 'user', content: '比较 AAPL 与 BTC 的风险' }],
  dependencies: fakeDependencies
});
assert.equal(state.goal, '比较 AAPL 与 BTC 的风险');
assert.deepEqual(state.plan, ['确认比较对象', '获取可用实时数据', '基于结果总结']);
assert.ok(state.plan.length <= 3);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec tsx --test tests/agentGraph.test.ts`

Expected: FAIL，因为 Graph 与规划节点不存在。

- [ ] **Step 3: 定义 `AgentState`、受限规划解析器和 `StateGraph`**

```ts
export interface AgentState {
  messages: ModelMessage[];
  goal: string;
  plan: string[];
  currentStep: number;
  pendingCalls: ToolCall[];
  toolRounds: number;
  completedCalls: number;
  finalAnswer: string;
  terminated: boolean;
  errorCode?: string;
}

const graph = new StateGraph(AgentStateAnnotation)
  .addNode('plan', planNode)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addNode('evaluate', evaluateNode)
  .addNode('final', finalNode)
  .addEdge(START, 'plan');
```

`planNode` 只能产出非空、每项最多 120 字符、最多三项的计划；解析失败时采用空计划并继续。`evaluateNode` 在没有工具调用、达到三轮/六次、断连或错误时路由到 `final`，否则路由到 `agent` 或 `tools`。

- [ ] **Step 4: 运行 Graph 规划测试**

Run: `pnpm exec tsx --test tests/agentGraph.test.ts`

Expected: PASS。

### Task 4: 将工具循环和 SSE 接入 Graph

**Files:**
- Modify: `server/agent/graph.ts`
- Modify: `server/deepseek.ts`
- Modify: `tests/deepseek.test.ts`
- Modify: `tests/agentGraph.test.ts`

- [ ] **Step 1: 写入失败测试，约束 Graph 工具路径、SSE 顺序与受控终止**

```ts
const events = await collectSse(() => streamDeepSeek(request, response, { toolRegistry, modelClient }));
assert.deepEqual(events.map((event) => event.type), ['tool', 'tool_result', 'delta', 'done']);
assert.equal(toolRegistry.calls, 1);
assert.equal(modelClient.calls, 2);
assert.equal(events.filter((event) => event.type === 'done').length, 1);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec tsx --test tests/{agentGraph,deepseek}.test.ts`

Expected: FAIL，因为旧编排器尚未经由 `StateGraph` 执行。

- [ ] **Step 3: 将现有模型流和工具执行器作为 Graph 节点依赖注入**

```ts
const toolsNode = async (state: AgentState, config: RunnableConfig) => {
  const result = await config.configurable.registry.execute(call, {
    ip: config.configurable.clientIp,
    signal: config.configurable.signal
  });
  config.configurable.emit({ type: 'tool_result', id: call.id, name: call.name, ...result });
  return { messages: [{ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) }] };
};
```

保留当前服务端策略、工具输出防注入、客户端角色过滤、受限金融上下文、重复 `done` 抑制、工具调用格式校验与断连中止。禁止在 Graph 内按天气/新闻/行情关键词选择工具。

- [ ] **Step 4: 运行 Graph 与服务端回归**

Run: `pnpm exec tsx --test tests/{agentGraph,deepseek,toolRegistry,liveContext,marketGateway,webSearch}.test.ts`

Expected: PASS。

### Task 5: 迁移客户端、入口和剩余测试为 TS/TSX

**Files:**
- Rename: `server/index.js` to `server/index.ts`
- Rename: `src/main.jsx` to `src/main.tsx`
- Rename: `src/App.jsx` to `src/App.tsx`
- Rename: `src/components/ChatWindow.jsx`, `FinancialWorkspace.jsx`, `Login.jsx`, `MessageItem.jsx`, `MessageList.jsx`, `Sidebar.jsx`, `StatusBar.jsx` to `.tsx`
- Rename: `src/lib/chat.js`, `db.js`, `history.js`, `market.js`, `offlineQueue.js`, `websocket.js` to `.ts`
- Rename: `tests/deepseek.test.js`, `financialLayout.test.js`, `financialUi.test.js`, `financialWorkspaces.test.js`, `history.test.js`, `offlineQueue.test.js`, `uiStyle.test.js` to `.test.ts`
- Modify: `README.md`

- [ ] **Step 1: 写入失败测试，约束客户端请求、工具事件和金融上下文的 TypeScript 合同**

```ts
const request = await capturedRequest();
assert.deepEqual(request.body.context, { financial: { tab: 'markets', symbol: 'AAPL' } });
assert.equal(request.body.messages.every((message: ChatMessage) => message.role !== 'system'), true);
```

- [ ] **Step 2: 运行客户端迁移测试确认失败**

Run: `pnpm exec tsx --test tests/{financialLayout,financialUi,financialWorkspaces,history,offlineQueue,uiStyle}.test.ts`

Expected: FAIL，直到 TSX 组件、浏览器事件和 IndexedDB 类型完成迁移。

- [ ] **Step 3: 迁移 React 与浏览器模块，保持页面协议**

```ts
export interface FinancialContext {
  financial: { tab: FinancialTab; symbol: string };
}

export async function streamChat(
  messages: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
  context?: FinancialContext
): Promise<void> { /* 保持 SSE 分发 */ }
```

保留 IndexedDB 数据结构、离线队列、工具结果卡片、自动联网说明和金融工作台；不引入客户端对 LangGraph 的依赖。

- [ ] **Step 4: 更新入口与 README，运行客户端回归**

Run: `pnpm exec tsx --test tests/{financialLayout,financialUi,financialWorkspaces,history,offlineQueue,uiStyle}.test.ts`

Expected: PASS。

### Task 6: 删除 JavaScript 源、全量验证与交付审计

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Test: `tests/**/*.test.ts`

- [ ] **Step 1: 运行扩展名检查，确认迁移前仍有 JavaScript 源**

Run: `rg --files server src tests -g '*.js' -g '*.jsx'`

Expected: 输出现有 JavaScript/JSX 源文件。

- [ ] **Step 2: 将剩余运行源码和测试重命名为 TypeScript 扩展名，并修正所有导入**

```sh
rg --files server src tests -g '*.js' -g '*.jsx'
```

逐个迁移该命令列出的文件；NodeNext 导入始终保留对应的 `.js` 运行时后缀，Vite/TSX 组件导入同步更新。

- [ ] **Step 3: 移除旧扩展名并补充最终运行说明**

```md
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

README 必须说明：LangGraph 只在服务端负责规划与编排；工具由服务端注册表受控执行；Graph 状态不等同于长期记忆。

- [ ] **Step 4: 运行完整验证**

Run: `pnpm typecheck`

Expected: PASS，strict TypeScript 零错误。

Run: `pnpm test`

Expected: PASS，所有 `.test.ts` 测试通过。

Run: `pnpm build`

Expected: PASS，Vite 生产构建成功。

Run: `rg --files server src tests -g '*.js' -g '*.jsx'`

Expected: 无输出。

- [ ] **Step 5: 检查变更与提交**

Run: `git status --short`

Expected: 只包含 TypeScript 和 LangGraph 相关改动；若工作区是 Git 仓库，提交信息为 `feat: migrate agent orchestration to typescript langgraph`。
