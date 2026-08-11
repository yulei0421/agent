import assert from 'node:assert/strict';
import test from 'node:test';
import { createTypewriter } from '../src/lib/typewriter.js';

test('renders streamed chunks one character at a time before draining', async () => {
  const updates: string[] = [];
  const typewriter = createTypewriter((text) => updates.push(text), 1);

  typewriter.push('你好');
  typewriter.push('！');
  await typewriter.drain();

  assert.deepEqual(updates, ['你', '你好', '你好！']);
});

test('cancels queued characters immediately', async () => {
  const updates: string[] = [];
  const typewriter = createTypewriter((text) => updates.push(text), 20);

  typewriter.push('不会显示');
  typewriter.cancel();
  await typewriter.drain();

  assert.deepEqual(updates, []);
});
