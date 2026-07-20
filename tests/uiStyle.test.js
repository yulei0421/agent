import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('ChatWindow forwards streaming state to MessageList', async () => {
  const source = await readSource('../src/components/ChatWindow.jsx');

  assert.match(source, /<MessageList\b[^>]*\bstreaming=\{streaming\}/);
});

test('MessageList forwards streaming state to MessageItem', async () => {
  const source = await readSource('../src/components/MessageList.jsx');

  assert.match(source, /<MessageItem\b[^>]*\bstreaming=\{streaming\}/);
});

test('MessageItem detects streaming messages by status', async () => {
  const source = await readSource('../src/components/MessageItem.jsx');

  assert.match(source, /message\.status\s*===\s*['\"]streaming['\"]/);
});

test('stylesheet provides the streaming visual contract and reduced-motion fallback', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /--text-body:\s*13px/);
  assert.match(source, /--radius-shell:\s*18px/);
  assert.match(source, /\.message\.assistant\.streaming/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

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

test('composer keeps placeholder text clear of its focused container ring', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.composer textarea,\s*\.composer textarea:hover,\s*\.composer textarea:focus\s*\{[\s\S]*padding:\s*10px 12px[\s\S]*box-shadow:\s*none/);
  assert.match(source, /\.composer textarea,\s*\.composer textarea:hover,\s*\.composer textarea:focus\s*\{[\s\S]*outline:\s*0/);
});

test('assistant messages have top breathing room and a flat tool-source attachment', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.message-list\s*\{[\s\S]*padding:\s*20px 0 28px/);
  assert.match(source, /\.message\s+\.tool-events\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent[\s\S]*box-shadow:\s*none/);
  assert.match(source, /\.message\s+\.tool-events:hover\s*\{[\s\S]*transform:\s*none/);
});

test('ChatWindow textarea submits on Enter while preserving Shift+Enter newlines', async () => {
  const source = await readSource('../src/components/ChatWindow.jsx');
  const textarea = source.match(/<textarea\b[\s\S]*?\/>/)?.[0] ?? '';

  assert.match(textarea, /onKeyDown=\{\(event\)\s*=>\s*\{\s*if\s*\(\s*event\.key\s*!==\s*['\"]Enter['\"]\s*\|\|\s*event\.shiftKey\s*\|\|\s*event\.nativeEvent\.isComposing\s*\)\s*return;\s*event\.preventDefault\(\);\s*event\.currentTarget\.form\?\.requestSubmit\(\);\s*\}\}/);
});

test('MessageList renders variable-height messages directly and provides a new-session empty state', async () => {
  const source = await readSource('../src/components/MessageList.jsx');

  assert.doesNotMatch(source, /getVirtualRange|virtualList/);
  assert.match(source, /messages\.length === 0/);
  assert.match(source, /className="chat-empty-state"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /messages\.map\(\(message\) =>/);
});

test('stylesheet keeps the composer visible while only the message list scrolls', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.workspace\s*\{[\s\S]*min-height:\s*0/);
  assert.match(source, /\.chat\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto[\s\S]*overflow:\s*hidden/);
  assert.match(source, /\.message-list\s*\{[\s\S]*min-height:\s*0[\s\S]*overflow:\s*auto/);
  assert.match(source, /\.composer textarea\s*\{[\s\S]*max-height:\s*180px[\s\S]*overflow-y:\s*auto/);
});

test('stylesheet differentiates message roles and protects composer actions on narrow screens', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.message\.user\s*\{[\s\S]*justify-self:\s*end[\s\S]*max-width:\s*min\(88%, 640px\)/);
  assert.match(source, /\.message\.assistant\s*\{[\s\S]*max-width:\s*min\(92%, 720px\)/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.web-search-control\s*\{[\s\S]*align-items:\s*flex-start[\s\S]*flex-direction:\s*column/);
  assert.match(source, /@media \(max-width: 420px\)[\s\S]*\.composer-actions\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*1fr 1fr/);
});

test('mobile layout condenses the sidebar so chat keeps the primary vertical space', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.app-shell\s*\{[\s\S]*grid-template-rows:\s*176px minmax\(0, 1fr\)/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.sidebar\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.session-list\s*\{[\s\S]*max-height:\s*48px[\s\S]*overflow-x:\s*auto/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.sidebar-footer\s*\{[\s\S]*display:\s*none/);
});
