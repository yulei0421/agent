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
    'data: {"type":"agent","role":"researcher","status":"completed"}\\n\\n',
    'data: {"type":"approval","id":"approval_abc123456","calls":[{"name":"get_quote","arguments":"{\\"symbol\\":\\"AAPL\\"}"}]}\\n\\n',
    'data: {"type":"plan","currentStep":0,"completed":false,"steps":[{"title":"查询行情","status":"in_progress"},{"title":"总结风险","status":"pending"}]}\\n\\n',
    'data: {"type":"reasoning","content":"分析中"}\\n\\n',
    'data: {"type":"delta","content":"报价已就绪"}\\n\\n',
    'data: {"type":"done"}\\n\\n'
  ].join('').replaceAll('\\n', '\n'));

  try {
    await streamChat([{ role: 'user', content: 'AAPL' }], new AbortController().signal, {
      onTool: (event) => received.push(['tool', event]),
      onToolResult: (event) => received.push(['tool_result', event]),
      onAgent: (event) => received.push(['agent', event]),
      onApproval: (event) => received.push(['approval', event]),
      onPlan: (event) => received.push(['plan', event]),
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
    ['agent', { type: 'agent', role: 'researcher', status: 'completed' }],
    ['approval', { type: 'approval', id: 'approval_abc123456', calls: [{ name: 'get_quote', arguments: '{"symbol":"AAPL"}' }] }],
    ['plan', { type: 'plan', currentStep: 0, completed: false, steps: [{ title: '查询行情', status: 'in_progress' }, { title: '总结风险', status: 'pending' }] }],
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

test('App preserves visible multi-agent collaboration events on the assistant message', async () => {
  const source = await readSource('../src/App.tsx');

  assert.match(source, /agentEvents:\s*\[\]/);
  assert.match(source, /function appendAgentEvent\(event: AgentEvent\)/);
  assert.match(source, /onAgent\(event\)[\s\S]*appendAgentEvent\(event\)/);
});

test('App and MessageItem preserve and render visible agent plans', async () => {
  const [app, item, plan] = await Promise.all([
    readSource('../src/App.tsx'),
    readSource('../src/components/MessageItem.tsx'),
    readSource('../src/components/AgentPlan.tsx')
  ]);

  assert.match(app, /let assistantPlan: AgentPlanSnapshot \| undefined/);
  assert.match(app, /onPlan\(event\)/);
  assert.match(app, /plan: assistantPlan/);
  assert.match(item, /<AgentPlan plan=\{message\.plan\}/);
  assert.match(plan, /任务计划/);
  assert.match(plan, /completed/);
  assert.match(plan, /step\.status/);
});

test('failed and stopped assistant messages expose a local retry action', async () => {
  const [app, item, list, chat] = await Promise.all([
    readSource('../src/App.tsx'),
    readSource('../src/components/MessageItem.tsx'),
    readSource('../src/components/MessageList.tsx'),
    readSource('../src/components/ChatWindow.tsx')
  ]);

  assert.match(app, /async function retryMessage\(message: ChatRecord\)/);
  assert.match(app, /message\.status !== 'error' && message\.status !== 'stopped'/);
  assert.match(app, /await send\(source\.content, undefined, source\.documents\)/);
  assert.match(item, /message\.status === 'error' \|\| message\.status === 'stopped'/);
  assert.match(item, /重新生成/);
  assert.match(list, /onRetry\?\.\(message\)/);
  assert.match(chat, /onRetry=\{onRetry\}/);
});

test('ChatWindow exposes bounded text and binary document attachments', async () => {
  const [chat, attachment] = await Promise.all([
    readSource('../src/components/ChatWindow.tsx'),
    readSource('../src/lib/attachments.ts')
  ]);
  const attachmentChip = chat.match(/<(span|div)\b[^>]*className="attachment-chip"[^>]*>[\s\S]*?<\/button>\s*<\/\1>/)?.[0] ?? '';

  assert.match(chat, /aria-label="添加附件"/);
  assert.match(attachmentChip, /className="attachment-chip"/);
  assert.match(attachmentChip, /<button\b[\s\S]*aria-label=\{`移除附件[^`]*\$\{attachment\.name\}[^`]*`\}[\s\S]*<\/button>/);
  assert.match(chat, /accept="\.txt,\.md,\.csv,\.json/);
  assert.match(chat, /normalizeTextAttachment\(file\.name, await file\.text\(\)\)/);
  assert.match(chat, /toChatDocument\(attachment\)/);
  assert.match(chat, /ingestBinaryAttachment\(file\)/);
  assert.match(attachment, /MAX_ATTACHMENT_CHARS = 3500/);
  assert.match(attachment, /ALLOWED_ATTACHMENT_EXTENSIONS/);
  assert.match(attachment, /api\/documents\/ingest/);
});

test('App sends financial mode as bounded request context instead of a client system message', async () => {
  const source = await readSource('../src/App.tsx');

  assert.match(source, /financialMode\s*\?\s*\{\s*financial:\s*\{\s*tab:\s*financialTab,\s*symbol:\s*financialSymbol\s*}\s*}\s*:\s*undefined/);
  assert.match(source, /streamChat\(payload, controller\.signal,[\s\S]*financialContext, financialMode \? 'financial_research' : 'text', reviewMode, documents/);
  assert.doesNotMatch(source, /role:\s*'system',\s*content:\s*`金融工作台/);
});

test('financial mode requests a structured report and renders a safe research card', async () => {
  const [app, item] = await Promise.all([
    readSource('../src/App.tsx'),
    readSource('../src/components/MessageItem.tsx')
  ]);

  assert.match(app, /financialMode \? 'financial_research' : 'text'/);
  assert.match(app, /parseResearchReport\(assistantText,[\s\S]*allowedSources/);
  assert.match(item, /结构化研究结果/);
  assert.match(item, /research-report/);
  assert.match(item, /风险提示/);
});

test('financial reports are accepted only against the current tool-result citation ledger', async () => {
  const source = await readSource('../src/App.tsx');

  assert.match(source, /collectResearchCitations/);
  assert.match(source, /allowedSources:\s*citationLedger\.map/);
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

test('MessageItem renders research and risk delegate statuses', async () => {
  const source = await readSource('../src/components/MessageItem.tsx');

  assert.match(source, /协作代理/);
  assert.match(source, /researcher/);
  assert.match(source, /risk_reviewer/);
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
