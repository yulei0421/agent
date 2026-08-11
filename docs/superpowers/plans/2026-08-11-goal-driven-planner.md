# 目标拆解驱动自主决策 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在生产 Nest 装配中注入模型 Planner，并让 LangGraph 以当前计划步骤约束模型和工具循环。

**Architecture:** 新增应用层 `Planner` 端口和基础设施 `ModelPlanner` 适配器，复用 `ModelClient` 输出受限 JSON 计划。Graph 每次模型调用临时注入当前步骤指令，工具轮成功后推进步骤，计划完成后强制无工具最终回答；计划不进入客户端事件或持久化消息。

**Tech Stack:** TypeScript strict、NestJS DI、LangGraph `StateGraph`、DeepSeek 流式客户端、Node.js test。

---

## 文件结构

- `server/application/chat/chat.ports.ts`：应用层模型与 Planner 端口、DI token 和 JSON 响应格式类型。
- `server/infrastructure/deepseek/model-planner.ts`：通过流式 `ModelClient` 生成并安全解析计划的基础设施实现。
- `server/infrastructure/deepseek/deepseek-client.ts`：将可选 JSON 输出格式映射到 DeepSeek `response_format`。
- `server/agent/state.ts`：保留纯 Graph 状态和计划规范化，不再拥有应用层 Planner 类型。
- `server/agent/graph.ts`：注入当前步骤内部指令，规划降级与工具轮步骤推进。
- `server/application/chat/chat.service.ts`：从应用层端口接收并传递 Planner。
- `server/app.module.ts`：注册 `PLANNER` 并装配给聊天应用服务。
- `tests/modelPlanner.test.ts`：Planner 适配器的流式、边界、错误和取消测试。
- `tests/deepSeekClient.test.ts`：DeepSeek JSON 输出格式序列化测试。
- `tests/agentGraph.test.ts`、`tests/chatApplication.test.ts`：Graph 计划消费、降级和 SSE 隔离测试。
- `tests/chatRuntime.test.ts`：生产 Nest 容器的 Planner 注册验证。
- `docs/superpowers/specs/2026-07-22-full-framework-architecture-design.md`、`docs/superpowers/plans/2026-07-22-full-framework-architecture.md`：将旧的“计划不进入模型提示词”表述替换为新的服务端内部指令不变量。

### Task 1: 定义 Planner 端口和模型适配器

**Files:**
- Modify: `server/application/chat/chat.ports.ts`
- Create: `server/infrastructure/deepseek/model-planner.ts`
- Modify: `server/infrastructure/deepseek/deepseek-client.ts`
- Test: `tests/modelPlanner.test.ts`
- Test: `tests/deepSeekClient.test.ts`

- [x] **Step 1: 编写 Planner 适配器失败测试**

创建 `tests/modelPlanner.test.ts`，先写完整测试夹具：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';
import { ModelPlanner } from '../server/infrastructure/deepseek/model-planner.js';
import type { DeepSeekSseEvent } from '../server/sse.js';

function recordingModel(events: readonly DeepSeekSseEvent[]): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async *stream(request) {
      requests.push(request);
      yield* events;
    }
  };
}

function failingModel(error: Error): ModelClient {
  return { async *stream() { throw error; } };
}
```

在夹具后添加：

```ts
test('ModelPlanner sends only the goal in a JSON-only, tool-free request', async () => {
  const model = recordingModel([{ type: 'delta', content: '{"steps":["查询天气","总结结果"]}' }, { type: 'done' }]);
  const planner = new ModelPlanner(model);

  assert.deepEqual(await planner.plan('上海天气'), ['查询天气', '总结结果']);
  assert.deepEqual(model.requests[0]?.tools, []);
  assert.deepEqual(model.requests[0]?.responseFormat, { type: 'json_object' });
  assert.equal(JSON.stringify(model.requests[0]?.messages).includes('上海天气'), true);
  assert.equal(JSON.stringify(model.requests[0]?.messages).includes('客户端历史'), false);
});

test('ModelPlanner returns an empty plan for malformed output or a non-abort model failure', async () => {
  assert.deepEqual(await new ModelPlanner(recordingModel([{ type: 'delta', content: 'not json' }])).plan('目标'), []);
  assert.deepEqual(await new ModelPlanner(failingModel(new Error('provider offline'))).plan('目标'), []);
});
```

- [x] **Step 2: 运行新测试并确认失败**

Run: `pnpm exec tsx --test tests/modelPlanner.test.ts`

Expected: FAIL，原因是 `ModelPlanner`、`Planner` 和 `responseFormat` 尚未定义。

- [x] **Step 3: 在应用端口中定义最小抽象**

在 `server/application/chat/chat.ports.ts` 添加以下导出，保持 `ModelClient` 是基础设施唯一依赖：

```ts
export const PLANNER = Symbol('PLANNER');

export type Planner = (goal: string, signal?: AbortSignal) => Promise<readonly string[]>;

export interface ModelRequest {
  messages: readonly unknown[];
  tools: readonly unknown[];
  forceFinalAnswer?: boolean;
  responseFormat?: { type: 'json_object' };
}
```

- [x] **Step 4: 实现受限 `ModelPlanner`**

创建 `server/infrastructure/deepseek/model-planner.ts`。实现必须：

```ts
const PLANNER_POLICY = 'You are a server-side planner. Return only a JSON object with a "steps" array of up to three concise strings. Do not call tools or include markdown.';

export class ModelPlanner {
  constructor(private readonly model: ModelClient) {}

  async plan(goal: string, signal?: AbortSignal): Promise<readonly string[]> {
    const activeSignal = signal ?? new AbortController().signal;
    let content = '';
    try {
      for await (const event of this.model.stream({
        messages: [{ role: 'system', content: PLANNER_POLICY }, { role: 'user', content: goal }],
        tools: [],
        responseFormat: { type: 'json_object' }
      }, activeSignal)) {
        if (event.type === 'delta') content += event.content;
      }
      const parsed: unknown = JSON.parse(content);
      if (!isStepObject(parsed)) return [];
      return parsed.steps.filter((step): step is string => typeof step === 'string');
    } catch (error) {
      if (activeSignal.aborted || (error instanceof AppError && error.code === 'request_aborted')) throw error;
      return [];
    }
  }
}
```

`isStepObject` 只接受对象自身的 `steps` 数组；不得接受原型属性。不要在 Planner 中写日志、SSE 事件或回显模型正文。

- [x] **Step 5: 将 JSON 格式传给 DeepSeek 并补充客户端测试**

在 `DeepSeekClient.stream()` 的请求体追加：

```ts
...(request.responseFormat ? { response_format: request.responseFormat } : {})
```

在 `tests/deepSeekClient.test.ts` 新增断言：

```ts
const body = JSON.parse(String(requests[0]?.init?.body));
assert.deepEqual(body.response_format, { type: 'json_object' });
```

测试调用的 `stream` 请求要传入 `responseFormat: { type: 'json_object' }`。

- [x] **Step 6: 运行适配器和客户端测试**

Run: `pnpm exec tsx --test tests/modelPlanner.test.ts tests/deepSeekClient.test.ts`

Expected: PASS，覆盖 JSON 拼接、空工具请求、非法输出和非取消异常降级。

### Task 2: 将生产 Planner 注入 Nest 与聊天应用服务

**Files:**
- Modify: `server/application/chat/chat.service.ts`
- Modify: `server/app.module.ts`
- Test: `tests/chatRuntime.test.ts`

- [x] **Step 1: 编写生产装配失败测试**

在 `tests/chatRuntime.test.ts` 添加：

```ts
test('the Nest composition root registers a production Planner for chat requests', async () => {
  const app = await createApp({ PORT: '8787', CLIENT_URL: 'http://127.0.0.1:5173' });
  try {
    const planner = app.get<Planner>(PLANNER);
    assert.equal(typeof planner, 'function');
  } finally {
    await app.close();
  }
});
```

导入 `PLANNER`、`Planner` 和 `createApp`。此测试不调用 Planner，因此不需要真实 API Key。

- [x] **Step 2: 运行装配测试并确认失败**

Run: `pnpm exec tsx --test tests/chatRuntime.test.ts`

Expected: FAIL，原因是 Nest 容器不存在 `PLANNER` provider。

- [x] **Step 3: 迁移聊天应用的 Planner 类型来源**

在 `server/application/chat/chat.service.ts` 删除从 `../../agent/state.js` 导入的 `Planner`，改为从本层 `chat.ports.ts` 导入。保留 `planner?: Planner`，确保测试中的自定义 Planner 仍可注入。

- [x] **Step 4: 注册生产 Planner 并传入聊天服务**

在 `server/app.module.ts`：

```ts
{
  provide: PLANNER,
  inject: [MODEL_CLIENT],
  useFactory: (model: ModelClient): Planner => {
    const planner = new ModelPlanner(model);
    return planner.plan.bind(planner);
  }
},
{
  provide: ChatApplicationService,
  inject: [MODEL_CLIENT, TOOL_EXECUTOR, PLANNER],
  useFactory: (model: ModelClient, tools: ToolExecutor, planner: Planner) =>
    new ChatApplicationService({ model, tools, planner })
}
```

添加 `PLANNER`、`Planner` 与 `ModelPlanner` 导入。禁止在 provider 中读取环境变量、创建额外模型客户端或绕过 `MODEL_CLIENT`。

- [x] **Step 5: 运行 Nest 装配测试**

Run: `pnpm exec tsx --test tests/chatRuntime.test.ts`

Expected: PASS，聊天 SSE 仍返回 `model_unavailable` 和 `done`，且容器可解析 `PLANNER`。

### Task 3: 让 LangGraph 使用计划步骤并在工具轮后推进

**Files:**
- Modify: `server/agent/state.ts`
- Modify: `server/agent/graph.ts`
- Modify: `server/application/chat/chat.service.ts`
- Test: `tests/agentGraph.test.ts`
- Test: `tests/chatApplication.test.ts`

- [x] **Step 1: 编写计划消费与降级失败测试**

在 `tests/agentGraph.test.ts` 的 imports 后添加测试夹具：

```ts
import type { ModelClient, ModelRequest } from '../server/application/chat/chat.ports.js';
import type { DeepSeekSseEvent } from '../server/sse.js';

function scriptedModel(requests: ModelRequest[], ...scripts: readonly DeepSeekSseEvent[][]): ModelClient {
  return {
    async *stream(request) {
      requests.push(request);
      yield* (scripts[requests.length - 1] ?? []);
    }
  };
}

function weatherExecutor(): ToolExecutor {
  return {
    definitions: () => [{ type: 'function', function: { name: 'get_weather', description: 'weather', parameters: { type: 'object' } } }],
    execute: async (call) => ({ ok: true, name: call.name, result: { weather: 'sunny' } })
  };
}

function emptyTools(): ToolExecutor {
  return { definitions: () => [], execute: async (call) => ({ ok: true, name: call.name, result: {} }) };
}

function systemContents(request: ModelRequest | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    const record = message as { role?: unknown; content?: unknown };
    return record.role === 'system' && typeof record.content === 'string' ? [record.content] : [];
  });
}
```

随后添加：

```ts
test('uses the current plan step only in server-owned model context and advances after a tool round', async () => {
  const requests: ModelRequest[] = [];
  const graph = createOnlineAgentGraph({
    planner: async () => ['查询天气', '根据结果总结'],
    model: scriptedModel(requests,
      [{ type: 'tool_call_delta', index: 0, id: 'weather', name: 'get_weather', arguments: '{"city":"上海"}' }, { type: 'done' }],
      [{ type: 'delta', content: '上海晴' }, { type: 'done' }]),
    tools: weatherExecutor()
  });

  const state = await graph.invoke({ goal: '上海天气', messages: [{ role: 'user', content: '上海天气' }] });
  assert.match(systemContents(requests[0]).join('\n'), /查询天气/);
  assert.equal(systemContents(requests[1]).some((content) => content.includes('查询天气')), false);
  assert.equal(state.currentStep, 1);
  assert.equal(state.events.some((event) => JSON.stringify(event).includes('查询天气')), false);
});

test('continues with an empty plan when a Planner rejects', async () => {
  const requests: ModelRequest[] = [];
  const graph = createOnlineAgentGraph({
    planner: async () => { throw new Error('offline'); },
    model: scriptedModel(requests, [{ type: 'delta', content: '你好' }, { type: 'done' }]),
    tools: emptyTools()
  });
  const state = await graph.invoke({ goal: '你好', messages: [{ role: 'user', content: '你好' }] });
  assert.deepEqual(state.plan, []);
  assert.deepEqual(state.events.map((event) => event.type), ['delta', 'done']);
});
```

在 `tests/chatApplication.test.ts` 将现有“Planner 失败产生 `internal_error` 且不启动模型”的四个测试改为：模型被调用一次、没有 `error` 事件、`done` 仅一次。保留取消期间 Planner 拒绝的测试，因为取消仍必须终止请求。

- [x] **Step 2: 运行图与聊天应用测试并确认失败**

Run: `pnpm exec tsx --test tests/agentGraph.test.ts tests/chatApplication.test.ts`

Expected: FAIL，现有 Graph 未将计划写入模型请求、未推进步骤且 Planner 拒绝会提前产生错误。

- [x] **Step 3: 解除 Graph 对应用 Planner 类型的反向依赖**

在 `server/agent/state.ts` 删除 `Planner` 类型导出；在 `server/agent/graph.ts` 改为从 `../application/chat/chat.ports.js` 导入 `Planner`。`normalizePlan()` 保持在状态文件，因为它是 Graph 的纯状态约束。

- [x] **Step 4: 添加内部计划指令和受控步骤推进**

在 `server/agent/graph.ts` 增加三个纯函数：

```ts
function currentPlanInstruction(state: AgentGraphState): ModelConversationMessage | null {
  const step = state.plan[state.currentStep];
  return typeof step === 'string'
    ? { role: 'system', content: `Authoritative server planning instruction: complete the current step: ${step}. Use only registered tools when current information is required; otherwise answer the user when the goal is complete.` }
    : null;
}

function messagesForModel(state: AgentGraphState): ModelConversationMessage[] {
  const instruction = currentPlanInstruction(state);
  if (!instruction) return [...state.messages];
  const firstNonSystem = state.messages.findIndex((message) => message.role !== 'system');
  const index = firstNonSystem === -1 ? state.messages.length : firstNonSystem;
  return [...state.messages.slice(0, index), instruction, ...state.messages.slice(index)];
}

function nextStep(plan: readonly string[], currentStep: number): number {
  return currentStep < plan.length ? currentStep + 1 : currentStep;
}
```

在 `modelNode` 中以 `messages: messagesForModel(state)` 替换 `messages: state.messages`，不得把该临时 instruction 写回 `state.messages`。在 `executeToolsNode` 成功处理完一个工具轮后，返回 `currentStep: nextStep(state.plan, state.currentStep)`；当下一步骤不存在时同时将 `forceFinalAnswer` 设为 `true`，以无工具模型调用将已获得的工具结果归纳为最终回答。

将 `createPlanNode` 对 Planner 非取消拒绝和非法返回值改为 `{ plan: [], currentStep: 0, terminated: false }`。保留 `ABORTED` 与 `signal.aborted` 的终止分支，不发布 Planner 错误事件。

- [x] **Step 5: 运行图和聊天应用测试**

Run: `pnpm exec tsx --test tests/agentGraph.test.ts tests/chatApplication.test.ts`

Expected: PASS，计划仅存在于临时模型上下文，工具轮后索引增加，规划失败仍可得到正常最终回答。

### Task 4: 对齐文档并执行完整验证

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-full-framework-architecture-design.md`
- Modify: `docs/superpowers/plans/2026-07-22-full-framework-architecture.md`
- Modify: `docs/superpowers/specs/2026-08-11-goal-driven-planner-design.md`（仅在实现与设计不一致时更新）

- [x] **Step 1: 更新过时不变量**

将两份旧文档中“计划不进入模型提示词或 SSE”替换为以下表述：

```md
计划不得进入 SSE、客户端消息、持久化历史或日志；当前计划步骤可作为服务端拥有的内部 system instruction 进入模型请求，用于约束模型的下一次工具选择或最终回答。
```

不要改写历史范围、前端契约或工具安全约束。

- [x] **Step 2: 运行针对性测试**

Run: `pnpm exec tsx --test tests/modelPlanner.test.ts tests/deepSeekClient.test.ts tests/agentGraph.test.ts tests/chatApplication.test.ts tests/chatRuntime.test.ts`

Expected: PASS。

- [x] **Step 3: 运行完整质量门禁**

Run: `pnpm typecheck && pnpm test && pnpm build && git diff --check`

Expected: 四个命令均以状态码 0 完成；不通过关闭 strict、删除测试或使用 `@ts-nocheck` 修复问题。

- [x] **Step 4: 检查变更范围**

Run: `git status --short && git diff --stat`

Expected: 仅包含本计划涉及的服务端、测试与文档文件，以及工作区原有的未提交变更；不回退或覆盖用户已有修改。当前工作区已脏且用户未要求提交，因此不创建提交。
