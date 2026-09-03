import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function cssRuleBody(source: string, selector: RegExp): string {
  const flags = selector.flags.replace(/[gy]/g, '');
  return new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, flags).exec(source)?.[1] ?? '';
}

function mediaSection(source: string, query: string): string {
  const start = source.indexOf(query);
  if (start < 0) return '';
  const nextMedia = source.indexOf('@media', start + query.length);
  return source.slice(start, nextMedia < 0 ? source.length : nextMedia);
}

test('ChatWindow forwards streaming state to MessageList', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');

  assert.match(source, /<MessageList\b[^>]*\bstreaming=\{streaming\}/);
});

test('MessageList forwards streaming state to MessageItem', async () => {
  const source = await readSource('../src/components/MessageList.tsx');

  assert.match(source, /<MessageItem\b[^>]*\bstreaming=\{streaming\}/);
});

test('MessageItem detects streaming messages by status', async () => {
  const source = await readSource('../src/components/MessageItem.tsx');

  assert.match(source, /message\.status\s*===\s*['\"]streaming['\"]/);
});

test('stylesheet provides the streaming visual contract and reduced-motion fallback', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /--text-body:\s*13px/);
  assert.match(source, /--radius-shell:\s*18px/);
  assert.match(source, /\.message\.assistant\.streaming/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('stylesheet provides the paper-terminal visual contract', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /--accent:\s*#0f766e/);
  assert.match(source, /--canvas:\s*#f4f1e8/);
  assert.match(source, /background:\s*radial-gradient\(circle at 14% 0%, rgba\(15, 118, 110, 0\.12\), transparent 28rem\)/);
  assert.doesNotMatch(source, /#7056f5|#18c8e8|glass-blur/);
  assert.match(source, /\.app-shell[\s\S]*border-radius:\s*var\(--radius-panel\)/);
  assert.match(source, /button:hover:not\(:disabled\)[\s\S]*translateY\(-1px\)/);
  assert.match(source, /button:active:not\(:disabled\)[\s\S]*scale\(0\.98\)/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('composer keeps placeholder text clear of its focused container ring', async () => {
  const source = await readSource('../src/styles.css');
  const textareaInteractionRule = cssRuleBody(
    source,
    /\.composer textarea,\s*\.composer textarea:hover,\s*\.composer textarea:focus/
  );

  assert.match(textareaInteractionRule, /box-shadow:\s*none/);
  assert.match(textareaInteractionRule, /outline:\s*0/);
});

test('composer uses compact textarea spacing', async () => {
  const source = await readSource('../src/styles.css');
  const textareaInteractionRule = cssRuleBody(
    source,
    /\.composer textarea,\s*\.composer textarea:hover,\s*\.composer textarea:focus/
  );

  assert.match(textareaInteractionRule, /padding:\s*8px 10px/);
});

test('assistant messages have top breathing room and a flat tool-source attachment', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.message-list\s*\{[\s\S]*padding:\s*20px 0 28px/);
  assert.match(source, /\.message\s+\.tool-events\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent[\s\S]*box-shadow:\s*none/);
  assert.match(source, /\.message\s+\.tool-events:hover\s*\{[\s\S]*transform:\s*none/);
});

test('ChatWindow renders exactly one compact toolbar without legacy composer sections', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');
  const toolbarCount = [...source.matchAll(/className="composer-toolbar"/g)].length;

  assert.equal(toolbarCount, 1);
  assert.doesNotMatch(source, /className="web-search-control"/);
  assert.doesNotMatch(source, /className="composer-context-note"/);
  assert.doesNotMatch(source, /className="composer-actions"/);
});

test('composer toolbar switches between stop and send button branches while streaming', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');
  const toolbarStart = source.indexOf('<div className="composer-toolbar"');
  const formEnd = toolbarStart >= 0 ? source.indexOf('</form>', toolbarStart) : -1;
  const toolbarToFormEnd = toolbarStart >= 0 && formEnd >= 0
    ? source.slice(toolbarStart, formEnd)
    : '';
  const actionBranches = /\{streaming\s*\?\s*\(\s*(<button\b[\s\S]*?<\/button>)\s*\)\s*:\s*\(\s*(<button\b[\s\S]*?<\/button>)\s*\)\s*\}/.exec(toolbarToFormEnd);
  const stopButton = actionBranches?.[1] ?? '';
  const sendButton = actionBranches?.[2] ?? '';

  assert.match(stopButton, /^<button\b[^>]*aria-label="停止生成"[^>]*>/);
  assert.match(stopButton, /^<button\b[^>]*onClick=\{onStop\}[^>]*>/);
  assert.match(stopButton, /^<button\b[^>]*type="button"[^>]*>[\s\S]*<\/button>$/);
  assert.match(sendButton, /^<button\b[^>]*aria-label="发送消息"[^>]*>/);
  assert.match(sendButton, /^<button\b[^>]*type="submit"[^>]*>[\s\S]*<\/button>$/);
  assert.match(sendButton, /^<button\b[^>]*disabled=\{attachmentLoading\s*\|\|\s*!content\.trim\(\)\}[^>]*>/);
});

test('ChatWindow textarea keeps compact rows and keyboard submission behavior', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');
  const textarea = source.match(/<textarea\b[\s\S]*?\/>/)?.[0] ?? '';

  assert.match(textarea, /ref=\{textareaRef\}/);
  assert.match(textarea, /rows=\{1\}/);
  assert.match(textarea, /onKeyDown=\{\(event\)\s*=>\s*\{\s*if\s*\(\s*event\.key\s*!==\s*['\"]Enter['\"]\s*\|\|\s*event\.shiftKey\s*\|\|\s*event\.nativeEvent\.isComposing\s*\)\s*return;\s*event\.preventDefault\(\);\s*event\.currentTarget\.form\?\.requestSubmit\(\);\s*\}\}/);
});

test('ChatWindow auto-sizes the textarea inside the content effect', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');
  const contentEffect = /useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[content\]\s*\);/.exec(source)?.[1] ?? '';

  assert.match(contentEffect, /const textarea = textareaRef\.current;\s*if \(!textarea\) return;\s*textarea\.style\.height = ['"]0px['"];\s*textarea\.style\.height = `\$\{Math\.min\(textarea\.scrollHeight,\s*200\)\}px`;\s*textarea\.style\.overflowY = textarea\.scrollHeight > 200 \? ['"]auto['"] : ['"]hidden['"];/);
});

test('MessageList renders variable-height messages directly and provides a new-session empty state', async () => {
  const source = await readSource('../src/components/MessageList.tsx');

  assert.doesNotMatch(source, /getVirtualRange|virtualList/);
  assert.match(source, /messages\.length === 0/);
  assert.match(source, /className="chat-empty-state"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /messages\.map\(\(message\) =>/);
});

test('stylesheet keeps the composer visible while the message list scrolls independently', async () => {
  const source = await readSource('../src/styles.css');
  const workspaceRule = cssRuleBody(source, /\.workspace/);
  const chatRule = cssRuleBody(source, /\.chat/);
  const messageListRule = cssRuleBody(source, /\.message-list/);

  assert.match(workspaceRule, /min-height:\s*0/);
  assert.match(chatRule, /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(chatRule, /overflow:\s*hidden/);
  assert.match(messageListRule, /min-height:\s*0/);
  assert.match(messageListRule, /overflow:\s*auto/);
});

test('stylesheet bounds the compact textarea and toolbar controls', async () => {
  const source = await readSource('../src/styles.css');
  const textareaRule = cssRuleBody(source, /\.composer textarea/);
  const toolbarRule = cssRuleBody(source, /\.composer-toolbar/);

  assert.match(textareaRule, /min-height:\s*40px/);
  assert.match(textareaRule, /max-height:\s*200px/);
  assert.match(textareaRule, /resize:\s*none/);
  assert.match(toolbarRule, /min-height:\s*44px/);
});

test('stylesheet differentiates user and assistant message roles', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.message\.user\s*\{[\s\S]*justify-self:\s*end[\s\S]*max-width:\s*min\(88%, 640px\)/);
  assert.match(source, /\.message\.assistant\s*\{[\s\S]*max-width:\s*min\(92%, 720px\)/);
});

test('420px media rules preserve the compact toolbar without legacy actions', async () => {
  const source = await readSource('../src/styles.css');
  const narrowSection = mediaSection(source, '@media (max-width: 420px)');

  assert.match(narrowSection, /\.composer-toolbar/);
  assert.doesNotMatch(narrowSection, /\.composer-actions/);
});

test('mobile layout condenses the sidebar so chat keeps the primary vertical space', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.app-shell\s*\{[\s\S]*grid-template-rows:\s*176px minmax\(0, 1fr\)/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.sidebar\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.session-list\s*\{[\s\S]*max-height:\s*48px[\s\S]*overflow-x:\s*auto/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.sidebar-footer\s*\{[\s\S]*display:\s*none/);
});
