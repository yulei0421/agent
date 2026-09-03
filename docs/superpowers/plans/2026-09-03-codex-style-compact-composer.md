# Codex 风格紧凑聊天输入区实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将聊天输入区重构为 Codex 风格的紧凑输入框，按需显示附件和错误状态，并让发送与停止在同一位置互斥切换。

**Architecture:** 保留 `ChatWindow` 现有 props、附件转换和提交数据流，只重组输入区内部结构并增加文本域自动高度调整。审批状态继续由 `App` 管理，组件通过现有回调切换；视觉行为集中在现有 `src/styles.css`，不新增全局状态或后端协议。

**Tech Stack:** React 19、TypeScript、Vite、Lucide React、Node Test Runner、Playwright

---

## 文件结构

- 修改 `src/components/ChatWindow.tsx`：重组输入区、接入图标、实现文本域自动增长及互斥发送/停止状态。
- 修改 `src/styles.css`：删除旧常驻说明布局，新增紧凑输入区、工具栏、附件状态和响应式样式。
- 修改 `tests/uiStyle.test.ts`：锁定输入区结构、自动增长、滚动和移动端行为。
- 修改 `tests/approvalUi.test.ts`：锁定审批按钮的切换语义和生成中禁用状态。
- 修改 `tests/financialUi.test.ts`：锁定附件入口和附件状态仍然存在。
- 修改 `package.json`、`pnpm-lock.yaml`：加入 `lucide-react`。
- 修改 `design-qa.md`：记录桌面端和移动端视觉验收结果。

### Task 1: 用测试锁定紧凑输入区契约

**Files:**
- Modify: `tests/uiStyle.test.ts`
- Modify: `tests/approvalUi.test.ts`
- Modify: `tests/financialUi.test.ts`
- Test: `tests/uiStyle.test.ts`
- Test: `tests/approvalUi.test.ts`
- Test: `tests/financialUi.test.ts`

- [ ] **Step 1: 更新输入区源码测试，使其描述新结构**

在 `tests/uiStyle.test.ts` 中删除旧的 `.composer-actions` 双按钮断言和旧 textarea 固定样式断言，加入以下测试：

```ts
test('ChatWindow renders one compact toolbar with mutually exclusive send and stop actions', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');

  assert.match(source, /className="composer-toolbar"/);
  assert.match(source, /streaming\s*\?\s*\([\s\S]*aria-label="停止生成"[\s\S]*\)\s*:\s*\([\s\S]*aria-label="发送消息"/);
  assert.doesNotMatch(source, /className="web-search-control"/);
  assert.doesNotMatch(source, /className="composer-context-note"/);
  assert.doesNotMatch(source, /className="composer-actions"/);
});

test('ChatWindow auto-sizes the textarea and keeps keyboard submission behavior', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');
  const textarea = source.match(/<textarea\b[\s\S]*?\/>/)?.[0] ?? '';

  assert.match(source, /textareaRef/);
  assert.match(source, /scrollHeight/);
  assert.match(source, /Math\.min\([^,]+,\s*200\)/);
  assert.match(textarea, /rows=\{1\}/);
  assert.match(textarea, /event\.key\s*!==\s*['"]Enter['"]/);
  assert.match(textarea, /event\.shiftKey/);
  assert.match(textarea, /event\.nativeEvent\.isComposing/);
});

test('stylesheet keeps the compact composer bounded and the message list independently scrollable', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.chat\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(source, /\.message-list\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(source, /\.composer textarea\s*\{[\s\S]*min-height:\s*40px[\s\S]*max-height:\s*200px[\s\S]*resize:\s*none/);
  assert.match(source, /\.composer-toolbar\s*\{[\s\S]*min-height:\s*44px/);
});

test('narrow screens preserve the compact toolbar instead of full-width action buttons', async () => {
  const source = await readSource('../src/styles.css');

  assert.doesNotMatch(source, /@media \(max-width: 420px\)[\s\S]*\.composer-actions/);
  assert.match(source, /@media \(max-width: 420px\)[\s\S]*\.composer-toolbar/);
});
```

- [ ] **Step 2: 更新审批与附件契约测试**

在 `tests/approvalUi.test.ts` 中将“常驻开关”断言替换为：

```ts
test('the compact composer exposes review mode as a pressed tool button', async () => {
  const chatWindow = await readSource('../src/components/ChatWindow.tsx');

  assert.match(chatWindow, /aria-pressed=\{approvalMode\}/);
  assert.match(chatWindow, /aria-label=\{approvalMode\s*\?\s*'关闭人工审批'\s*:\s*'开启人工审批'\}/);
  assert.match(chatWindow, /disabled=\{streaming\}/);
  assert.match(chatWindow, /onReviewModeChange\(!approvalMode\)/);
});
```

在 `tests/financialUi.test.ts` 的附件测试中补充：

```ts
assert.match(chat, /aria-label="添加附件"/);
assert.match(chat, /className="attachment-chip"/);
assert.match(chat, /aria-label=\{`移除附件/);
```

- [ ] **Step 3: 运行相关测试并确认失败**

Run:

```bash
pnpm exec tsx --test tests/uiStyle.test.ts tests/approvalUi.test.ts tests/financialUi.test.ts
```

Expected: FAIL，失败原因包括缺少 `composer-toolbar`、缺少自动高度逻辑、审批仍为 checkbox，以及发送和停止仍同时渲染。

- [ ] **Step 4: 提交测试契约**

```bash
git add tests/uiStyle.test.ts tests/approvalUi.test.ts tests/financialUi.test.ts
git commit -m "test: define compact composer interaction contract"
```

### Task 2: 重构 `ChatWindow` 输入交互

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/components/ChatWindow.tsx`
- Test: `tests/uiStyle.test.ts`
- Test: `tests/approvalUi.test.ts`
- Test: `tests/financialUi.test.ts`

- [ ] **Step 1: 安装统一图标依赖**

Run:

```bash
pnpm add lucide-react
```

Expected: `package.json` 的 dependencies 出现 `lucide-react`，`pnpm-lock.yaml` 更新成功。

- [ ] **Step 2: 引入图标和文本域引用**

将 `ChatWindow.tsx` 的 import 调整为：

```tsx
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { LoaderCircle, Paperclip, Send, ShieldCheck, Square, X } from 'lucide-react';
```

在组件状态后加入：

```tsx
const textareaRef = useRef<HTMLTextAreaElement>(null);

useEffect(() => {
  const textarea = textareaRef.current;
  if (!textarea) return;
  textarea.style.height = '0px';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  textarea.style.overflowY = textarea.scrollHeight > 200 ? 'auto' : 'hidden';
}, [content]);
```

- [ ] **Step 3: 将表单重组为文本域、状态行和单层工具栏**

保留现有 `onSubmit`、附件读取和键盘事件逻辑，将 `<form className="composer">` 内部替换为以下结构：

```tsx
<textarea
  aria-label={financialMode ? '金融对话输入' : '聊天输入'}
  placeholder={placeholder}
  ref={textareaRef}
  rows={1}
  value={content}
  onChange={(event) => setContent(event.target.value)}
  onKeyDown={(event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }}
/>

{(attachmentLoading || attachment || attachmentError) && (
  <div className="composer-status-row">
    {attachmentLoading && (
      <span className="attachment-loading">
        <LoaderCircle aria-hidden="true" size={14} />
        正在解析附件
      </span>
    )}
    {attachment && !attachmentLoading && (
      <span className="attachment-chip">
        <span title={attachment.name}>{attachment.name}</span>
        <button
          aria-label={`移除附件 ${attachment.name}`}
          disabled={streaming}
          onClick={() => setAttachment(null)}
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </span>
    )}
    {attachmentError && <span className="attachment-error" role="alert">{attachmentError}</span>}
  </div>
)}

<div className="composer-toolbar">
  <div className="composer-tools">
    <label
      aria-disabled={streaming || attachmentLoading}
      className="composer-icon-button attachment-picker"
      title="添加 TXT、Markdown、CSV、JSON、PDF 或图片"
    >
      <Paperclip aria-hidden="true" size={18} />
      <span className="sr-only">添加附件</span>
      <input
        accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,text/csv,application/json,application/pdf,image/png,image/jpeg,image/webp"
        aria-label="添加附件"
        disabled={streaming || attachmentLoading}
        onChange={handleAttachmentChange}
        type="file"
      />
    </label>
    <button
      aria-label={approvalMode ? '关闭人工审批' : '开启人工审批'}
      aria-pressed={approvalMode}
      className="composer-tool-button"
      disabled={streaming}
      onClick={() => onReviewModeChange(!approvalMode)}
      title="开启后，工具执行前会等待你的批准"
      type="button"
    >
      <ShieldCheck aria-hidden="true" size={18} />
      <span>审批</span>
    </button>
  </div>

  {streaming ? (
    <button aria-label="停止生成" className="composer-submit stop" onClick={onStop} title="停止生成" type="button">
      <Square aria-hidden="true" size={16} fill="currentColor" />
    </button>
  ) : (
    <button
      aria-label="发送消息"
      className="composer-submit"
      disabled={attachmentLoading || !content.trim()}
      title="发送消息"
      type="submit"
    >
      <Send aria-hidden="true" size={18} />
    </button>
  )}
</div>
```

将原附件 `<input>` 的异步处理提取为组件内函数，保持原有校验和错误文案：

```tsx
async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = '';
  setAttachmentError('');
  if (!file) return;
  const isText = /\.(?:txt|md|markdown|csv|json)$/iu.test(file.name);
  if (isText) {
    const next = normalizeTextAttachment(file.name, await file.text());
    if (!next) {
      setAttachmentError('仅支持非空 TXT、MD、CSV、JSON 文件，且内容不超过 3500 个字符。');
      return;
    }
    setAttachment(next);
    return;
  }
  setAttachmentLoading(true);
  try {
    setAttachment(await ingestBinaryAttachment(file));
  } catch (error) {
    setAttachmentError(error instanceof Error ? error.message : '附件解析失败');
  } finally {
    setAttachmentLoading(false);
  }
}
```

- [ ] **Step 4: 运行组件契约测试**

Run:

```bash
pnpm exec tsx --test tests/uiStyle.test.ts tests/approvalUi.test.ts tests/financialUi.test.ts
```

Expected: 组件结构、审批和附件相关测试通过；样式测试仍可能因 CSS 尚未调整而失败。

- [ ] **Step 5: 运行类型检查**

Run:

```bash
pnpm typecheck
```

Expected: PASS，无 React 事件类型、Lucide props 或 JSX 类型错误。

- [ ] **Step 6: 提交组件重构**

```bash
git add package.json pnpm-lock.yaml src/components/ChatWindow.tsx
git commit -m "feat: add compact codex-style composer controls"
```

### Task 3: 收紧输入区布局和响应式行为

**Files:**
- Modify: `src/styles.css`
- Test: `tests/uiStyle.test.ts`

- [ ] **Step 1: 用紧凑输入区样式替换旧常驻说明样式**

删除 `.web-search-control`、`.web-search-toggle`、`.approval-toggle`、`.composer-actions`、`.composer-context-note` 和旧 `.composer-attachment` 样式，加入：

```css
.composer {
  position: relative;
  display: grid;
  gap: 4px;
  width: min(100%, 760px);
  margin: 0 auto;
  padding: 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-composer);
  background: var(--surface-raised);
  box-shadow: 0 10px 24px rgba(48, 57, 45, 0.09);
}

.composer::before {
  position: absolute;
  z-index: -1;
  right: -24px;
  bottom: -20px;
  left: -24px;
  height: 72px;
  background: linear-gradient(180deg, transparent, var(--surface));
  pointer-events: none;
  content: '';
}

.composer:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1), 0 10px 24px rgba(48, 57, 45, 0.09);
}

.composer textarea {
  min-height: 40px;
  max-height: 200px;
  overflow-y: hidden;
  resize: none;
  line-height: 24px;
}

.composer textarea,
.composer textarea:hover,
.composer textarea:focus {
  padding: 8px 10px;
  border: 0;
  box-shadow: none;
  outline: 0;
}

.composer-toolbar {
  display: flex;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.composer-tools {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.composer-icon-button,
.composer-tool-button,
.composer-submit {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-control);
}

.composer-icon-button,
.composer-tool-button {
  border-color: transparent;
  background: transparent;
  color: var(--muted);
}

.composer-icon-button {
  width: 44px;
  flex: 0 0 44px;
  padding: 0;
  cursor: pointer;
}

.composer-icon-button[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.48;
}

.composer-tool-button {
  gap: 6px;
  padding: 0 10px;
  font-size: var(--text-meta);
}

.composer-tool-button[aria-pressed="true"] {
  background: var(--accent-pale);
  color: var(--accent-deep);
}

.composer-icon-button:hover,
.composer-tool-button:hover:not(:disabled) {
  border-color: transparent;
  background: var(--surface-muted);
  color: var(--accent-deep);
  box-shadow: none;
  transform: none;
}

.composer-submit {
  width: 44px;
  flex: 0 0 44px;
  padding: 0;
}

.composer-submit.stop {
  border-color: #dfb7b1;
  background: #f7e7e3;
  color: var(--danger);
}

.composer-submit.stop:hover:not(:disabled) {
  border-color: #d39a92;
  background: #f2d7d2;
  color: #7d2f27;
}

.composer-status-row {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 4px 4px;
}

.attachment-picker input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.attachment-chip {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  min-height: 30px;
  align-items: center;
  gap: 4px;
  padding: 3px 3px 3px 9px;
  border: 1px solid #b7d2c9;
  border-radius: var(--radius-control);
  background: var(--accent-pale);
  color: var(--accent-deep);
  font-size: var(--text-meta);
}

.attachment-chip > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-chip button {
  width: 28px;
  min-height: 28px;
  flex: 0 0 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: currentColor;
}

.attachment-chip button:hover:not(:disabled) {
  background: rgba(15, 118, 110, 0.1);
  box-shadow: none;
  transform: none;
}

.attachment-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-deep);
  font-size: var(--text-meta);
}

.attachment-loading svg {
  animation: attachment-spin 900ms linear infinite;
}

.attachment-error {
  color: var(--danger);
  font-size: var(--text-meta);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}

@keyframes attachment-spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 2: 调整小屏幕样式**

删除旧 `@media (max-width: 420px)` 中 `.composer-actions` 的双列规则，替换为：

```css
@media (max-width: 420px) {
  .chat { padding-right: 10px; padding-left: 10px; }
  .composer-toolbar { gap: 4px; }
  .composer-tool-button { padding: 0 8px; }
}
```

保持 `@media (prefers-reduced-motion: reduce)` 的全局规则，使附件解析图标在减少动态效果模式下近乎静止。

- [ ] **Step 3: 运行样式和交互测试**

Run:

```bash
pnpm exec tsx --test tests/uiStyle.test.ts tests/approvalUi.test.ts tests/financialUi.test.ts
```

Expected: PASS。

- [ ] **Step 4: 运行完整测试、类型检查和生产构建**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: 三条命令均以退出码 `0` 完成。

- [ ] **Step 5: 提交布局样式**

```bash
git add src/styles.css
git commit -m "style: tighten chat composer layout"
```

### Task 4: 浏览器视觉验收与记录

**Files:**
- Modify: `design-qa.md`
- Verify: `src/components/ChatWindow.tsx`
- Verify: `src/styles.css`

- [ ] **Step 1: 启动开发服务**

Run:

```bash
pnpm dev
```

Expected: Vite 输出可访问的本地 URL，Nest 服务成功监听且无启动错误。如果默认端口被占用，记录 Vite 实际分配的端口。

- [ ] **Step 2: 使用 Playwright 验收桌面默认状态**

在 `1440x900` 视口登录并进入聊天页，确认：

```text
- 空输入状态只有文本域和单层工具栏。
- 输入区高度约 104px，不显示模型工具说明、本地记忆说明或常驻审批卡。
- 附件、审批、发送按钮对齐，消息列表获得明显更多高度。
- 键盘焦点环清晰，没有元素重叠或横向滚动。
```

保存截图到 `/tmp/deepseek-compact-composer-desktop.png`。

- [ ] **Step 3: 验收交互状态**

依次检查：

```text
1. 输入十行文本，输入框增长但不超过约 200px。
2. 开启审批，按钮出现持续选中状态。
3. 选择附件，文件标签出现且长文件名被截断，点击移除按钮后消失。
4. 发送消息，发送按钮原位切换为停止按钮；停止后恢复发送按钮。
5. Enter 发送、Shift+Enter 换行，中文输入法组合态不会误发送。
```

保存包含长输入和审批状态的截图到 `/tmp/deepseek-compact-composer-states.png`。

- [ ] **Step 4: 使用 Playwright 验收移动端**

在 `390x844` 视口确认：

```text
- 工具栏不横向溢出。
- 附件、审批和发送/停止按钮仍可触达。
- 输入区不会变成两个全宽按钮。
- 消息列表仍独立滚动，输入区保持在底部。
- 所有按钮和输入内容不存在遮挡。
```

保存截图到 `/tmp/deepseek-compact-composer-mobile.png`。

- [ ] **Step 5: 记录视觉验收结果**

在 `design-qa.md` 追加：

```markdown
## 2026-09-03 Codex 风格紧凑输入区

- 桌面视口：1440 × 900
- 移动视口：390 × 844
- 默认高度：约 104px
- 已验证状态：空输入、长输入、审批开启、附件、生成中、停止
- 布局结果：消息列表独立滚动；输入区无横向溢出、遮挡或双全宽操作按钮
- 验证命令：`pnpm test`、`pnpm typecheck`、`pnpm build`
```

- [ ] **Step 6: 最终提交**

```bash
git add design-qa.md
git commit -m "docs: record compact composer visual qa"
```

## 最终验收

- [ ] 对照 `docs/superpowers/specs/2026-09-03-codex-style-compact-composer-design.md` 的八条验收标准逐项确认。
- [ ] 运行 `git status --short`，确认未误提交用户原有的 README 或其他无关改动。
- [ ] 运行 `git log -5 --oneline`，确认测试、组件、样式和视觉验收提交都存在。
- [ ] 打开三张 Playwright 截图，确认实际渲染与设计目标一致。
