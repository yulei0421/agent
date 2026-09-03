import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function openingTagContaining(sourceText: string, tagName: string, marker: RegExp): string {
  const markerMatch = marker.exec(sourceText);
  const start = markerMatch ? sourceText.lastIndexOf(`<${tagName}`, markerMatch.index) : -1;
  if (start < 0) return '';

  let braceDepth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (let index = start; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '{') {
      braceDepth += 1;
    } else if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (character === '>' && braceDepth === 0) {
      return sourceText.slice(start, index + 1);
    }
  }

  return '';
}

test('chat streaming accepts an explicit review mode and routes approval events', async () => {
  const chat = await source('../src/lib/chat.ts');

  assert.match(chat, /review = false/);
  assert.match(chat, /onApproval\?/);
  assert.match(chat, /review\s*\?\s*\{ review: true \}/);
  assert.match(chat, /event\.type === 'approval'/);
});

test('streamChat sends the review flag only when requested', async () => {
  const { streamChat } = await import('../src/lib/chat.js');
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body ?? '');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
        controller.close();
      }
    });
    return new Response(body, { status: 200 });
  };
  try {
    await streamChat([{ role: 'user', content: '审批' }], new AbortController().signal, {}, undefined, 'text', true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal((JSON.parse(requestBody) as { review?: boolean }).review, true);
});

test('the compact composer exposes review mode as a pressed tool button without changing the automatic default', async () => {
  const chatWindow = await source('../src/components/ChatWindow.tsx');
  const app = await source('../src/App.tsx');
  const approvalButtonStartTag = openingTagContaining(
    chatWindow,
    'button',
    /aria-label=\{approvalMode\s*\?\s*['"]关闭人工审批['"]\s*:\s*['"]开启人工审批['"]\}/
  );

  assert.match(approvalButtonStartTag, /^<button\b[\s\S]*>$/);
  assert.match(approvalButtonStartTag, /aria-label=\{approvalMode\s*\?\s*['"]关闭人工审批['"]\s*:\s*['"]开启人工审批['"]\}/);
  assert.match(approvalButtonStartTag, /aria-pressed=\{approvalMode\}/);
  assert.match(approvalButtonStartTag, /disabled=\{streaming\}/);
  assert.match(approvalButtonStartTag, /onClick=\{\(\)\s*=>\s*onReviewModeChange\(!approvalMode\)\}/);
  assert.match(approvalButtonStartTag, /type="button"/);
  assert.match(app, /const \[reviewMode, setReviewMode\] = useState\(false\)/);
  assert.match(app, /reviewMode/);
});

test('messages render approval actions and call the approval decision endpoint', async () => {
  const item = await source('../src/components/MessageItem.tsx');

  assert.match(item, /message\.approval/);
  assert.match(item, /api\/approvals/);
  assert.match(item, /批准/);
  assert.match(item, /拒绝/);
});
