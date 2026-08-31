import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
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

test('the composer exposes review mode without changing the automatic default', async () => {
  const chatWindow = await source('../src/components/ChatWindow.tsx');
  const app = await source('../src/App.tsx');

  assert.match(chatWindow, /人工审批/);
  assert.match(chatWindow, /onReviewModeChange/);
  assert.match(chatWindow, /approvalMode/);
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
