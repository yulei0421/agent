import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { streamChat } from '../src/lib/chat.js';

async function readSource(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function streamResponse(events: string): Response {
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
  const received: unknown[] = [];
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
  assert.match(source, /function appendToolEvent\(event: ToolEvent\): void/);
  assert.match(source, /toolEvents:\s*\[\.\.\.\(item\.toolEvents \?\? \[\]\), event\]/);
  assert.match(source, /onTool\(event\)[\s\S]*appendToolEvent\(event\)/);
  assert.match(source, /onToolResult\(event\)[\s\S]*appendToolEvent\(event\)/);
});

test('App sends financial mode as bounded request context instead of a client system message', async () => {
  const source = await readSource('../src/App.tsx');

  assert.match(source, /financialMode\s*\?\s*\{\s*financial:\s*\{\s*tab:\s*financialTab,\s*symbol:\s*financialSymbol\s*}\s*}\s*:\s*undefined/);
  assert.match(source, /streamChat\(payload, controller\.signal,[\s\S]*financialContext, financialMode \? 'financial_research' : 'text'\)/);
  assert.doesNotMatch(source, /role:\s*'system',\s*content:\s*`金融工作台/);
});

test('financial mode requests a structured report and renders a safe research card', async () => {
  const [app, item] = await Promise.all([
    readSource('../src/App.tsx'),
    readSource('../src/components/MessageItem.tsx')
  ]);

  assert.match(app, /financialMode \? 'financial_research' : 'text'/);
  assert.match(app, /parseResearchReport\(assistantText\)/);
  assert.match(item, /结构化研究结果/);
  assert.match(item, /research-report/);
  assert.match(item, /风险提示/);
});

test('MessageItem renders generic registry events and result-backed tool cards', async () => {
  const source = await readSource('../src/components/MessageItem.tsx');

  assert.match(source, /数据来源与工具调用/);
  assert.match(source, /toolEvents\.length/);
  assert.match(source, /event\.type === 'tool'/);
  assert.match(source, /event\.type === 'tool_result' && event\.ok/);
  assert.match(source, /event\.ok/);
  assert.match(source, /toolResult\.result/);
  assert.match(source, /event\.errorCode/);
  assert.match(source, /quoteMeta\.source/);
  assert.match(source, /quoteMeta\.asOf/);
  assert.match(source, /quoteMeta\.delay/);
  assert.match(source, /weather\.observedAt/);
  assert.match(source, /weather\.ageSeconds/);
  assert.match(source, /未解析代码/);
  assert.match(source, /eventRecords\(message\.toolEvents\)/);
  assert.match(source, /Array\.isArray\(result\.sources\)/);
  assert.match(source, /typeof value === 'object'/);
  assert.doesNotMatch(source, /source\.url|href=\{source\.url\}/);
});

test('MessageItem limits structured market cards to validated successful SSE tool results', async () => {
  const [item, styles] = await Promise.all([
    readSource('../src/components/MessageItem.tsx'),
    readSource('../src/styles.css')
  ]);

  assert.match(item, /function technicalIndicatorResult\(value: unknown\)/);
  assert.match(item, /function economicCalendarResult\(value: unknown\)/);
  assert.match(item, /event\.type === 'tool_result' && event\.ok/);
  assert.match(item, /event\.name === 'get_technical_indicators' && technicalIndicators/);
  assert.match(item, /event\.name === 'get_economic_calendar' && economicCalendar/);
  assert.match(item, /技术指标/);
  assert.match(item, /经济日历/);
  assert.match(item, /aria-label="技术指标结果"/);
  assert.match(item, /aria-label="经济日历结果"/);
  assert.match(item, /aria-live="polite"/);
  assert.match(styles, /\.technical-indicators-card, \.economic-calendar-card/);
  assert.match(styles, /\.technical-indicators-grid/);
  assert.match(styles, /\.economic-calendar-list/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.technical-indicators-grid/);
});
