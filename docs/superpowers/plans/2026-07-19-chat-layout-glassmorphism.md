# 聊天页面布局与玻璃质感整理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 修复长对话挤出输入框的问题，并在保留玻璃质感的前提下统一聊天页的阅读层级与小屏行为。

**架构：** 普通聊天页面改为由 `workspace` 提供确定可用高度、`chat` 管理两行布局、`message-list` 单独滚动的结构。移除固定高度的虚拟列表，因为它与实际高度可变的 Markdown 消息不兼容；消息直接渲染，同时保留现有消息对象、流式状态与发送逻辑。样式在现有 Aurora 覆盖层中收束，不引入新的设计系统或依赖。

**技术栈：** React 19、Vite、CSS、Node 内置测试运行器（`node --test`）。

---

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/components/MessageList.jsx` | 直接渲染可变高度消息、提供新会话空状态，保留 `MessageItem` 的流式状态传递。 |
| `src/lib/virtualList.js` | 删除；固定条目高度的计算不适用于可变高度 Markdown 消息。 |
| `src/styles.css` | 建立工作区/聊天区的高度链和滚动边界，收束玻璃面板、消息、工具记录、输入框与移动端样式。 |
| `tests/uiStyle.test.js` | 用源码契约覆盖布局边界、空状态、输入框与玻璃效果的关键规则。 |
| `tests/virtualList.test.js` | 删除；虚拟列表功能随实现移除。 |

### Task 1：以失败测试锁定聊天布局契约

**文件：**

- 修改：`tests/uiStyle.test.js`
- 删除：`tests/virtualList.test.js`（若该文件在开始实施时不存在，则不创建）
- 测试：`tests/uiStyle.test.js`

- [ ] **Step 1：为直接渲染与空状态添加失败测试**

  在 `tests/uiStyle.test.js` 末尾添加以下测试。它们明确要求消息列表不再依赖固定高度虚拟化，并要求空状态具备语义化状态提示：

  ```js
  test('MessageList renders variable-height messages directly and provides a new-session empty state', async () => {
    const source = await readSource('../src/components/MessageList.jsx');

    assert.doesNotMatch(source, /getVirtualRange|virtualList/);
    assert.match(source, /messages\.length === 0/);
    assert.match(source, /className="chat-empty-state"/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /messages\.map\(\(message\) =>/);
  });
  ```

- [ ] **Step 2：为高度链、滚动边界和输入限制添加失败测试**

  同一文件继续添加：

  ```js
  test('stylesheet keeps the composer visible while only the message list scrolls', async () => {
    const source = await readSource('../src/styles.css');

    assert.match(source, /\.workspace\s*\{[\s\S]*min-height:\s*0/);
    assert.match(source, /\.chat\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto[\s\S]*overflow:\s*hidden/);
    assert.match(source, /\.message-list\s*\{[\s\S]*min-height:\s*0[\s\S]*overflow:\s*auto/);
    assert.match(source, /\.composer textarea\s*\{[\s\S]*max-height:\s*180px[\s\S]*overflow-y:\s*auto/);
  });
  ```

- [ ] **Step 3：为消息层级与窄屏操作区添加失败测试**

  同一文件继续添加：

  ```js
  test('stylesheet differentiates message roles and protects composer actions on narrow screens', async () => {
    const source = await readSource('../src/styles.css');

    assert.match(source, /\.message\.user\s*\{[\s\S]*justify-self:\s*end[\s\S]*max-width:\s*min\(88%, 640px\)/);
    assert.match(source, /\.message\.assistant\s*\{[\s\S]*max-width:\s*min\(92%, 720px\)/);
    assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.web-search-control\s*\{[\s\S]*align-items:\s*flex-start[\s\S]*flex-direction:\s*column/);
    assert.match(source, /@media \(max-width: 420px\)[\s\S]*\.composer-actions\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*1fr 1fr/);
  });
  ```

- [ ] **Step 4：运行测试，确认测试在实现前失败**

  运行：`node --test tests/uiStyle.test.js`

  预期：新增的三项测试失败，分别提示固定虚拟列表、缺少空状态或缺少布局规则；既有测试继续通过。

### Task 2：移除固定高度虚拟化并提供空状态

**文件：**

- 修改：`src/components/MessageList.jsx`
- 删除：`src/lib/virtualList.js`
- 测试：`tests/uiStyle.test.js`

- [ ] **Step 1：将 `MessageList` 改为直接渲染可变高度消息**

  将组件替换为以下实现。不要改变 `MessageItem` 的 props 或消息排序责任：

  ```jsx
  import { MessageItem } from './MessageItem.jsx';

  export function MessageList({ messages, streaming }) {
    if (messages.length === 0) {
      return (
        <section className="message-list" aria-live="polite">
          <div className="chat-empty-state">
            <p className="eyebrow">新会话</p>
            <h1>从一个问题开始</h1>
            <p>输入你的任务，必要时开启联网搜索；回答和数据来源会显示在这里。</p>
          </div>
        </section>
      );
    }

    return (
      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <div className="message-slot" key={message.id}>
            <MessageItem message={message} streaming={streaming} />
          </div>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 2：删除不再使用的虚拟列表模块**

  删除 `src/lib/virtualList.js`。删除前用 `rg -n "virtualList|getVirtualRange" src tests` 确认没有剩余调用；若存在测试文件 `tests/virtualList.test.js`，一并删除。

- [ ] **Step 3：运行目标测试，确认组件契约通过**

  运行：`node --test tests/uiStyle.test.js`

  预期：直接渲染/空状态测试通过；布局和窄屏测试仍因 CSS 未修改而失败。

- [ ] **Step 4：提交可独立工作的组件改动**

  若工作目录位于 Git 仓库中，运行：

  ```bash
  git add src/components/MessageList.jsx src/lib/virtualList.js tests/uiStyle.test.js
  git commit -m "fix: render chat messages at their natural height"
  ```

  当前工作目录未检测到 Git 仓库；在这种情况下跳过提交，不要初始化仓库或修改用户的版本控制设置。

### Task 3：建立高度链并收束玻璃视觉层级

**文件：**

- 修改：`src/styles.css`
- 测试：`tests/uiStyle.test.js`

- [ ] **Step 1：为工作区、聊天区和消息区写入最小布局规则**

  在 Aurora 覆盖层中新增或覆盖以下规则；保留金融模式的既有网格规则：

  ```css
  .workspace {
    min-height: 0;
    overflow: hidden;
  }

  .chat {
    min-height: 0;
    overflow: hidden;
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .chat.financial-chat {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .message-list {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 20px 0 28px;
  }
  ```

- [ ] **Step 2：实现消息阅读列、空状态和输入区限制**

  在同一层加入以下规则，使用现有颜色变量而不新建色板：

  ```css
  .message-slot {
    display: grid;
    width: min(100%, 760px);
    margin: 0 auto;
    padding: 8px 0;
  }

  .message.user {
    justify-self: end;
    width: fit-content;
    max-width: min(88%, 640px);
  }

  .message.assistant {
    justify-self: start;
    width: fit-content;
    max-width: min(92%, 720px);
    padding: 14px 16px;
  }

  .chat-empty-state {
    width: min(100%, 560px);
    margin: auto;
    padding: 28px;
    border: 1px solid var(--glass-line);
    border-radius: var(--radius-panel);
    background: rgba(255, 255, 255, 0.42);
    box-shadow: 0 14px 36px rgba(73, 94, 157, 0.09);
  }

  .composer textarea {
    min-height: 72px;
    max-height: 180px;
    overflow-y: auto;
    resize: vertical;
  }
  ```

- [ ] **Step 3：降低不必要的漂浮与工具记录的视觉权重**

  将 `body::before`、`body::after` 的动画改为只保留静态背景；将 `.message:hover` 和普通卡片悬停的 `translateY(-4px)` 改为不移动布局的轻阴影变化。保持 `.message .tool-events` 的透明底和左侧标记，不恢复卡片背景或大阴影。

- [ ] **Step 4：运行测试，确认高度与视觉契约通过**

  运行：`node --test tests/uiStyle.test.js`

  预期：所有样式契约测试通过，且既有流式、玻璃效果与 Enter/Shift+Enter 测试不回归。

- [ ] **Step 5：提交样式改动**

  若在 Git 仓库中，运行：

  ```bash
  git add src/styles.css tests/uiStyle.test.js
  git commit -m "fix: keep the chat composer within the viewport"
  ```

  非 Git 工作目录跳过此步骤。

### Task 4：补齐小屏输入操作区并做回归验证

**文件：**

- 修改：`src/styles.css`
- 测试：`tests/uiStyle.test.js`、`tests/financialLayout.test.js`、`tests/financialUi.test.js`

- [ ] **Step 1：实现窄屏排列规则**

  在现有 `@media (max-width: 800px)` 和 `@media (max-width: 420px)` 中加入：

  ```css
  @media (max-width: 800px) {
    .chat { padding: 16px; }
    .web-search-control {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
    }
    .web-search-control p { text-align: left; }
  }

  @media (max-width: 420px) {
    .composer-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .composer-actions button { width: 100%; }
  }
  ```

- [ ] **Step 2：运行全部前端测试**

  运行：`node --test tests/uiStyle.test.js tests/financialLayout.test.js tests/financialUi.test.js`

  预期：全部通过；金融布局仍保留独立滚动区域，金融聊天的三行网格不回归。

- [ ] **Step 3：构建生产包**

  运行：`pnpm build`

  预期：Vite 构建成功，生成 `dist/`，无 ESLint 或模块解析错误。

- [ ] **Step 4：视觉验收**

  在桌面宽度和 390px 宽度下分别打开已有的长对话与新会话，逐项检查：

  1. 输入区保持在聊天面板底部，页面不会因长回复继续增长。
  2. 鼠标滚轮只滚动消息列表，状态栏、侧栏和输入区不移动。
  3. 空状态、用户消息、助手消息与工具调用记录的优先级清楚。
  4. 窄屏无横向溢出，联网开关说明与两个操作按钮都完整可见。
  5. 联网搜索开关、Enter 发送、Shift+Enter 换行和停止生成保持可用。

- [ ] **Step 5：提交完成状态**

  若在 Git 仓库中，运行：

  ```bash
  git add src/styles.css tests/uiStyle.test.js
  git commit -m "fix: make chat controls responsive"
  ```

  非 Git 工作目录跳过此步骤，并在交付中说明无法提交的原因。

## 自检结果

- 规格覆盖：Task 2 覆盖可变高度消息和空状态；Task 3 覆盖固定输入区、玻璃层级、消息/工具记录；Task 4 覆盖窄屏与功能回归。
- 完整性检查：计划不含未决开发标记或延后实施的步骤。
- 一致性检查：`MessageList` 仍将同一个 `streaming` prop 传给 `MessageItem`，没有更改 `ChatWindow` 的发送快捷键、`App` 的消息数据结构或金融模式网格。
