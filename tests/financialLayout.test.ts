import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('financial mode composes a compact top bar, workbench navigation, research canvas, and dedicated chat panel', async () => {
  const [app, workspace, chat] = await Promise.all([
    readSource('../src/App.tsx'),
    readSource('../src/components/FinancialWorkspace.tsx'),
    readSource('../src/components/ChatWindow.tsx')
  ]);

  assert.match(app, /financial-workbench-bar/);
  assert.match(app, /financial-mode-layout/);
  assert.match(workspace, /financial-workbench-nav/);
  assert.match(workspace, /financial-research-canvas/);
  assert.match(chat, /financial-chat-panel/);
  for (const label of ['行情研究', '事件投研', '交易员 Copilot', '自选', '预警']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.doesNotMatch(workspace, /financial-card|financial-layout/);
});

test('financial layout gives its navigation, research canvas, and chat message area independent scroll regions', async () => {
  const source = await readSource('../src/styles.css');

  for (const className of ['financial-workbench-nav', 'financial-research-canvas', 'financial-chat-panel']) {
    assert.match(source, new RegExp(`\\.${className}\\s*\\{[\\s\\S]*?overflow:\\s*(?:auto|hidden)`));
  }
  assert.match(source, /\.financial-mode-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)\s+minmax\(280px, 360px\)/);
});

test('financial layout stacks navigation, canvas, and chat in reading order on mobile without invented live data', async () => {
  const [workspace, styles] = await Promise.all([
    readSource('../src/components/FinancialWorkspace.tsx'),
    readSource('../src/styles.css')
  ]);

  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.financial-research-workbench\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.financial-mode-layout\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(workspace, /尚未发起数据查询|等待查询/);
  assert.doesNotMatch(workspace, /实时(?:报价|数据|行情)/);
});
