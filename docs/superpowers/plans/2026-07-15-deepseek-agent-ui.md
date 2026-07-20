# DeepSeek Agent UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 DeepSeek Agent 现有功能重构为紧凑、圆角柔和、以流式输出为重点的工作台界面。

**Architecture:** 继续使用现有 React 组件结构和单一全局样式表。仅在 `ChatWindow`、`MessageItem` 和 `MessageList` 增加能够表达流式状态的 CSS 类，所有视觉令牌、响应式布局与减少动态效果降级集中在 `styles.css`。

**Tech Stack:** React 19、Vite 7、原生 CSS、Node.js test runner。

---

## 文件结构

- 修改：`src/styles.css` — 视觉令牌、紧凑布局、交互状态、流式动效、响应式规则和减少动态效果规则。
- 修改：`src/components/ChatWindow.jsx` — 将 `streaming` 传入消息列表，并为输入区和发送/停止控件提供稳定样式钩子。
- 修改：`src/components/MessageList.jsx` — 将流式状态传给每条消息。
- 修改：`src/components/MessageItem.jsx` — 仅为正在生成的 AI 消息添加 `streaming` 类和可访问的生成提示。
- 新建：`tests/uiStyle.test.js` — 读取样式与组件源文件，验证流式状态、减少动态效果规则和紧凑视觉令牌不会意外移除。

### Task 1: 为流式状态建立失败测试

**Files:**
- Create: `tests/uiStyle.test.js`
- Test: `tests/uiStyle.test.js`

- [ ] **Step 1: 编写失败测试**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('streaming assistant messages expose a focused visual state', async () => {
  const [messageItem, messageList, chatWindow] = await Promise.all([
    readSource('src/components/MessageItem.jsx'),
    readSource('src/components/MessageList.jsx'),
    readSource('src/components/ChatWindow.jsx')
  ]);

  assert.match(chatWindow, /<MessageList messages=\{messages\} streaming=\{streaming\}/);
  assert.match(messageList, /<MessageItem message=\{message\} streaming=\{streaming\}/);
  assert.match(messageItem, /message\.status === 'streaming'/);
});

test('stylesheet keeps compact tokens and a reduced-motion fallback', async () => {
  const css = await readSource('src/styles.css');

  assert.match(css, /--text-body:\s*13px/);
  assert.match(css, /--radius-shell:\s*18px/);
  assert.match(css, /\.message\.assistant\.streaming/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test tests/uiStyle.test.js`

Expected: FAIL，原因是消息组件尚未接收 `streaming` 状态，且样式令牌与减少动态效果规则尚不存在。

- [ ] **Step 3: 提交测试**

```bash
git add tests/uiStyle.test.js
git commit -m "test: define compact streaming UI contract"
```

说明：当前项目目录未初始化 Git 时跳过提交，但保留测试文件。

### Task 2: 让消息组件暴露流式视觉状态

**Files:**
- Modify: `src/components/ChatWindow.jsx`
- Modify: `src/components/MessageList.jsx`
- Modify: `src/components/MessageItem.jsx`
- Test: `tests/uiStyle.test.js`

- [ ] **Step 1: 传递流式状态**

将 `ChatWindow` 中的消息列表调用改为：

```jsx
<MessageList messages={messages} streaming={streaming} />
```

将 `MessageList` 签名和消息项调用改为：

```jsx
export function MessageList({ messages, streaming }) {
  // 保持已有虚拟滚动计算不变。
}

<MessageItem message={message} streaming={streaming} />
```

将 `MessageItem` 签名与文章类名改为：

```jsx
export function MessageItem({ message, streaming }) {
  const isStreamingAssistant = streaming && message.role === 'assistant' && message.status === 'streaming';

  return (
    <article className={`message ${message.role}${isStreamingAssistant ? ' streaming' : ''}`}>
```

- [ ] **Step 2: 添加生成提示**

在消息元信息中、保留原始 `message.status` 的同时，为 `isStreamingAssistant` 添加视觉提示：

```jsx
{isStreamingAssistant ? <span className="streaming-label">生成中</span> : null}
```

- [ ] **Step 3: 运行单测并确认通过**

Run: `pnpm test tests/uiStyle.test.js`

Expected: 仍失败，且仅失败在 `styles.css` 缺少令牌和动效选择器；组件传参相关断言通过。

### Task 3: 实现紧凑圆角工作台视觉与流式聚焦动效

**Files:**
- Modify: `src/styles.css`
- Test: `tests/uiStyle.test.js`

- [ ] **Step 1: 建立视觉令牌和基础可访问性规则**

在 `:root` 中定义下列关键令牌，并让按钮、输入控件继承字体：

```css
:root {
  --text-body: 13px;
  --text-meta: 11px;
  --radius-shell: 18px;
  --radius-control: 11px;
  --radius-composer: 15px;
  --ink: #202420;
  --muted: #737870;
  --canvas: #f4f4f0;
  --surface: #ffffff;
  --accent: #557a5c;
  --accent-soft: #e8f0e7;
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 3px solid #9cc9a2;
  outline-offset: 2px;
}
```

- [ ] **Step 2: 重写页面各区域样式**

将原有深色侧栏和厚边框消息卡替换为以下规则：桌面 `.app-shell` 位于 `24px` 外边距内并使用 `--radius-shell`；`.sidebar` 为浅色表面，`.session-row.active` 使用 `--accent-soft` 和 3px 左侧指示条；`.workspace` 与 `.message-list` 为白色阅读区；`.message` 不使用整圈厚边框；`.composer` 使用 `--radius-composer`。正文使用 `var(--text-body)`，元信息使用 `var(--text-meta)`。

- [ ] **Step 3: 添加流式聚焦和交互状态**

追加下列核心规则，其他动画规则不得超过 220ms：

```css
.message.assistant.streaming {
  animation: message-arrive 180ms ease-out both;
}

.message.assistant.streaming::after {
  content: "";
  display: inline-block;
  width: 4px;
  height: 13px;
  margin-left: 4px;
  background: var(--accent);
  animation: caret-blink 900ms step-end infinite;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

并为会话行和操作按钮添加悬停、按下和禁用状态，使用 `transform: translateY(-2px)` 或 `translateX(2px)` 作为唯一位移动效。

- [ ] **Step 4: 运行 UI 合约测试并确认通过**

Run: `pnpm test tests/uiStyle.test.js`

Expected: PASS，2 个测试都通过。

- [ ] **Step 5: 提交视觉重构**

```bash
git add src/styles.css src/components/ChatWindow.jsx src/components/MessageList.jsx src/components/MessageItem.jsx tests/uiStyle.test.js
git commit -m "feat: refresh DeepSeek agent workspace UI"
```

说明：当前项目目录未初始化 Git 时跳过提交。

### Task 4: 回归验证与响应式检查

**Files:**
- Modify: `src/styles.css`（仅在验证发现问题时）
- Test: `tests/uiStyle.test.js`

- [ ] **Step 1: 运行完整自动化测试**

Run: `pnpm test`

Expected: PASS，现有 SSE、历史记录和离线队列测试不回归，新增 UI 合约测试通过。

- [ ] **Step 2: 构建生产包**

Run: `pnpm build`

Expected: Vite 构建完成，输出包含 `dist/index.html` 和资源文件。

- [ ] **Step 3: 手动检查视图**

Run: `pnpm dev`

Expected: 桌面与 800px 以下视图无横向滚动；登录、发送、停止生成、会话切换、删除和清空仍然可操作；开启减少动态效果后无循环装饰动画。

- [ ] **Step 4: 提交验证修正（如有）**

```bash
git add src/styles.css tests/uiStyle.test.js
git commit -m "fix: refine responsive agent workspace"
```

说明：只有验证需要修正时才创建此提交；当前项目目录未初始化 Git 时跳过提交。
