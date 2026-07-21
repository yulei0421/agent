import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { streamChat } from '../src/lib/chat.js';

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function streamResponse(events) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(events));
      controller.close();
    }
  });
  return new Response(body, { status: 200 });
}

test('Sidebar provides an accessible financial conversation entry', async () => {
  const source = await readSource('../src/components/Sidebar.tsx');

  assert.match(source, /onFinancialMode/);
  assert.match(source, /金融对话/);
  assert.match(source, /aria-pressed=\{financialMode\}/);
});

test('ChatWindow explains financial context and suggests explicit market symbols', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');

  assert.match(source, /financialMode/);
  assert.match(source, /金融对话/);
  assert.match(source, /600519\.SH/);
  assert.match(source, /0700\.HK/);
  assert.match(source, /BTC\/USDT/);
  assert.match(source, /const placeholder = financialMode/);
  assert.match(source, /placeholder=\{placeholder\}/);
});

test('streamChat forwards tool and tool_result events without disrupting text events', async () => {
  const originalFetch = globalThis.fetch;
  const received = [];
  globalThis.fetch = async () => streamResponse([
    'data: {"type":"tool","id":"call_quote","name":"get_quote"}\\n\\n',
    'data: {"type":"tool_result","id":"call_quote","name":"get_quote","ok":true,"result":{"data":{"price":210,"currency":"USD"},"meta":{"symbol":"AAPL","source":"yahoo-finance","asOf":"2026-07-15T00:00:00.000Z","delay":"15m"}}}\\n\\n',
    'data: {"type":"reasoning","content":"分析中"}\\n\\n',
    'data: {"type":"delta","content":"报价已就绪"}\\n\\n',
    'data: {"type":"done"}\\n\\n'
  ].join('').replaceAll('\\n', '\n'));

  try {
    await streamChat([{ role: 'user', content: 'AAPL' }], new AbortController().signal, {
      onTool: (event) => received.push(['tool', event]),
      onToolResult: (event) => received.push(['tool_result', event]),
      onReasoning: (content) => received.push(['reasoning', content]),
      onDelta: (content) => received.push(['delta', content]),
      onDone: () => received.push(['done'])
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(received, [
    ['tool', { type: 'tool', id: 'call_quote', name: 'get_quote' }],
    ['tool_result', { type: 'tool_result', id: 'call_quote', name: 'get_quote', ok: true, result: { data: { price: 210, currency: 'USD' }, meta: { symbol: 'AAPL', source: 'yahoo-finance', asOf: '2026-07-15T00:00:00.000Z', delay: '15m' } } }],
    ['reasoning', '分析中'],
    ['delta', '报价已就绪'],
    ['done']
  ]);
});

test('App preserves early tool events on the streaming assistant message', async () => {
  const source = await readSource('../src/App.tsx');

  assert.match(source, /const \[financialMode, setFinancialMode\] = useState\(false\)/);
  assert.match(source, /toolEvents:\s*\[\]/);
  assert.match(source, /function appendToolEvent\(event\)/);
  assert.match(source, /toolEvents:\s*\[\.\.\.\(item\.toolEvents \?\? \[\]\), event\]/);
  assert.match(source, /onTool\(event\)[\s\S]*appendToolEvent\(event\)/);
  assert.match(source, /onToolResult\(event\)[\s\S]*appendToolEvent\(event\)/);
});

test('App sends financial mode as bounded request context instead of a client system message', async () => {
  const source = await readSource('../src/App.tsx');

  assert.match(source, /financialMode\s*\?\s*\{\s*financial:\s*\{\s*tab:\s*financialTab,\s*symbol:\s*financialSymbol\s*}\s*}\s*:\s*undefined/);
  assert.match(source, /streamChat\(payload, abortRef\.current\.signal,[\s\S]*financialContext\)/);
  assert.doesNotMatch(source, /role:\s*'system',\s*content:\s*`金融工作台/);
});

test('MessageItem renders generic registry events and result-backed tool cards', async () => {
  const source = await readSource('../src/components/MessageItem.tsx');

  assert.match(source, /数据来源与工具调用/);
  assert.match(source, /toolEvents\.length/);
  assert.match(source, /event\.type === 'tool'/);
  assert.match(source, /event\.type !== 'tool_result'/);
  assert.match(source, /event\.ok/);
  assert.match(source, /event\.result/);
  assert.match(source, /event\.errorCode/);
  assert.match(source, /event\.result\?\.meta\?\.source/);
  assert.match(source, /event\.result\?\.meta\?\.asOf/);
  assert.match(source, /event\.result\?\.meta\?\.delay/);
  assert.match(source, /event\.result\?\.weather\?\.observedAt/);
  assert.match(source, /event\.result\?\.weather\?\.ageSeconds/);
  assert.match(source, /未解析代码/);
  assert.match(source, /Array\.isArray\(message\.toolEvents\)/);
  assert.match(source, /Array\.isArray\(event\.result\?\.sources\)/);
  assert.match(source, /typeof event === 'object'/);
  assert.doesNotMatch(source, /source\.url|href=\{source\.url\}/);
});
