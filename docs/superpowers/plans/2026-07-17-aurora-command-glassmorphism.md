# Aurora Command Glassmorphism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 AI 会话与金融研究行为的前提下，把现有 React 工作台重构为选定的 Aurora Command 浅色玻璃拟态界面。

**Architecture:** 只改动现有样式表与一条样式源码测试。通过集中设计令牌统一背景、表面、圆角、阴影与动效；现有 JSX 类名、状态和事件处理不变，因此登录、会话、流式输出、金融模式、工具溯源和输入行为不受影响。

**Tech Stack:** React 19、Vite、原生 CSS、Node Test Runner。

---

### Task 1: 锁定 Aurora Command 视觉契约

**Files:**
- Modify: `tests/uiStyle.test.js`
- Test: `tests/uiStyle.test.js`

- [ ] **Step 1: 写入失败的样式契约测试**

```js
test('stylesheet provides the Aurora Command glassmorphism contract', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /--accent-gradient:\s*linear-gradient\(135deg, #18c8e8 0%, #7056f5 100%\)/);
  assert.match(source, /--glass-blur:\s*20px/);
  assert.match(source, /backdrop-filter:\s*blur\(var\(--glass-blur\)\)/);
  assert.match(source, /\.app-shell[\s\S]*border-radius:\s*var\(--radius-panel\)/);
  assert.match(source, /button:hover:not\(:disabled\)[\s\S]*translateY\(-4px\)/);
  assert.match(source, /button:active:not\(:disabled\)[\s\S]*scale\(0\.98\)/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/uiStyle.test.js`

Expected: 新增测试因 `--accent-gradient` 和 `--glass-blur` 尚不存在而失败。

### Task 2: 建立浅色玻璃基础层

**Files:**
- Modify: `src/styles.css:1-180`
- Test: `tests/uiStyle.test.js`

- [ ] **Step 1: 用 Aurora 令牌替换根级颜色、圆角与阴影**

```css
:root {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --canvas: #edf2ff;
  --ink: #17213d;
  --muted: #697694;
  --accent-gradient: linear-gradient(135deg, #18c8e8 0%, #7056f5 100%);
  --glass-blur: 20px;
  --glass: rgba(255, 255, 255, 0.62);
  --glass-strong: rgba(255, 255, 255, 0.8);
  --glass-line: rgba(255, 255, 255, 0.3);
  --radius-panel: 24px;
  --radius-pill: 100px;
  --radius-inner: 8px;
}
```

- [ ] **Step 2: 为 `body`、登录面板、`.app-shell` 与 `.sidebar` 应用背景光、玻璃表面和扩散阴影**

```css
body { background: linear-gradient(135deg, #dff8ff 0%, #f6f4ff 52%, #e9ddff 100%); }
.app-shell, .login-panel { backdrop-filter: blur(var(--glass-blur)); background: var(--glass); border: 1px solid var(--glass-line); border-radius: var(--radius-panel); box-shadow: 0 24px 70px rgba(91, 92, 170, .16); }
```

- [ ] **Step 3: 运行新增测试确认通过**

Run: `pnpm test tests/uiStyle.test.js`

Expected: 新增 Aurora 契约及原有流式样式测试全部通过。

### Task 3: 重塑可交互表面与信息层级

**Files:**
- Modify: `src/styles.css:181-1059`
- Test: `tests/uiStyle.test.js`

- [ ] **Step 1: 统一按钮、侧栏会话、金融导航和输入器的悬浮/按下反馈**

```css
button:hover:not(:disabled) { transform: translateY(-4px); box-shadow: 0 14px 30px rgba(85, 89, 179, .24); }
button:active:not(:disabled) { transform: translateY(-1px) scale(.98); }
.sidebar > button, .financial-chat-entry, .composer-actions button:last-child { background: var(--accent-gradient); border-radius: var(--radius-pill); }
```

- [ ] **Step 2: 将消息、工具溯源、金融工作台与输入区改为半透明白玻璃层，并保留所有现有类名**

```css
.message, .tool-events, .research-asset-selector, .research-query-state, .research-query-brief, .composer {
  background: rgba(255, 255, 255, .5);
  border: 1px solid var(--glass-line);
  box-shadow: 0 12px 34px rgba(73, 94, 157, .08);
  backdrop-filter: blur(var(--glass-blur));
}
```

- [ ] **Step 3: 把标题、正文、元信息与数据条调整为 Aurora 的类型比例，并保持错误和状态文字可读**

```css
.financial-canvas-header h1, .financial-context h1 { font-size: clamp(1.9rem, 3vw, 3.35rem); font-weight: 700; letter-spacing: -.055em; }
.message p, .financial-canvas-content p { line-height: 1.8; }
```

- [ ] **Step 4: 运行全部单元测试**

Run: `pnpm test`

Expected: 全部测试通过；组件事件和消息数据行为未受样式改动影响。

### Task 4: 完成响应式、减弱动态和浏览器验证

**Files:**
- Modify: `src/styles.css:1060-1211`
- Test: `tests/uiStyle.test.js`

- [ ] **Step 1: 在窄屏保留玻璃层与 44px 操作尺寸，避免横向溢出**

```css
@media (max-width: 800px) {
  .app-shell { border-radius: 0; }
  .sidebar, .workspace { min-width: 0; }
  button { min-height: 44px; }
}
```

- [ ] **Step 2: 在减少动态偏好下停止背景漂移与交互位移动画**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}
```

- [ ] **Step 3: 构建并在浏览器检查登录、聊天和金融工作台**

Run: `pnpm build`

Expected: Vite 构建成功；在 1440px 与 800px 以下视图中无水平溢出，页面保留会话、输入、金融模式及状态控件。

- [ ] **Step 4: 记录人工视觉核对结果**

Create: `design-qa.md`

```md
# Design QA

final result: passed

- 参考：选定的 Aurora Command 概念稿（第 3 张）。
- 1440px：玻璃外壳、青紫主操作、浅蓝淡紫背景、阅读区和输入区均可见且无截断。
- 800px：无横向溢出；按钮和输入区可触达。
- 功能：会话、金融模式、联网搜索开关、发送/停止和状态栏保留。
```

## 自检

- 设计说明中的背景、字体、玻璃表面、圆角、单一强调色、动效、减少动态与功能保留均映射到 Tasks 1-4。
- 计划不存在 `TBD`、`TODO`、未定义类型或不明确的文件路径。
- 当前目录不是 Git 仓库，故不包含无法执行的提交步骤。
