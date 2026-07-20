import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('FinancialWorkspace exposes three accessible workbench tabs', async () => {
  const source = await readSource('../src/components/FinancialWorkspace.jsx');

  assert.match(source, /role="tablist"/);
  assert.match(source, /行情研究/);
  assert.match(source, /事件投研/);
  assert.match(source, /交易员 Copilot/);
  assert.match(source, /aria-selected=\{activeTab === tab\.id\}/);
});

test('App owns the current financial tab and selected asset context', async () => {
  const source = await readSource('../src/App.jsx');

  assert.match(source, /const \[financialTab, setFinancialTab\] = useState\('markets'\)/);
  assert.match(source, /const \[financialSymbol, setFinancialSymbol\] = useState\('AAPL'\)/);
  assert.match(source, /<FinancialWorkspace[\s\S]*activeTab=\{financialTab\}[\s\S]*symbol=\{financialSymbol\}/);
  assert.match(source, /<ChatWindow[\s\S]*financialSymbol=\{financialSymbol\}/);
});

test('market research lists supported assets and only describes data states', async () => {
  const source = await readSource('../src/components/FinancialWorkspace.jsx');

  for (const symbol of ['AAPL', '0700.HK', '600519.SH', 'BTC/USDT']) {
    assert.match(source, new RegExp(symbol.replace('/', '\\/')));
  }
  assert.match(source, /报价、数据来源和更新时间将在查询后展示/);
  assert.match(source, /金融对话/);
  assert.doesNotMatch(source, /实时(?:报价|数据|行情)/);
});

test('event and trader workbenches disclose tool requirements and research-only safety states', async () => {
  const source = await readSource('../src/components/FinancialWorkspace.jsx');

  assert.match(source, /通过工具获取新闻\/公告/);
  assert.match(source, /未配置新闻或公告工具/);
  assert.match(source, /加密衍生品/);
  assert.match(source, /预警和风险条件/);
  assert.match(source, /仅研究，不执行下单/);
  assert.match(source, /未配置衍生品数据工具|暂无衍生品数据/);
  assert.doesNotMatch(source, /今日[\u4e00-\u9fa5]*上涨|研报正文|目标价/);
});

test('ChatWindow presents the selected symbol as financial context', async () => {
  const source = await readSource('../src/components/ChatWindow.jsx');

  assert.match(source, /financialSymbol/);
  assert.match(source, /当前资产/);
  assert.match(source, /\{financialSymbol\}/);
});

test('financial workbench styles stack navigation, canvas, and chat panels on mobile', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.financial-research-workbench/);
  assert.match(source, /\.financial-research-canvas/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.financial-research-workbench\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});

test('mobile financial asset results stay in flow instead of covering the research navigation', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /@media \(max-width: 800px\)\s*\{[\s\S]*\.asset-search-results\s*\{[\s\S]*position:\s*static/);
});

test('desktop financial asset results remain a compact anchored popover without stretching the top bar', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.financial-workbench-bar\s+\.asset-search-results\s*\{[\s\S]*position:\s*absolute/);
  assert.match(source, /\.financial-workbench-bar\s+\.asset-search-results\s*\{[\s\S]*max-height:\s*min\(18rem,\s*calc\(100dvh\s*-\s*12rem\)\)/);
  assert.match(source, /\.financial-workbench-bar\s+\.asset-search-results\s*\{[\s\S]*background:\s*#fafdff/);
});

test('active financial entry uses a unified surface instead of an inset selection rail', async () => {
  const source = await readSource('../src/styles.css');
  const activeRule = source.match(/\.sidebar > button\.financial-entry\[aria-pressed="true"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.doesNotMatch(activeRule, /inset\s+3px\s+0/);
  assert.match(activeRule, /background:\s*linear-gradient/);
});

test('session rows present the title and delete action as one integrated control', async () => {
  const [source, sidebar] = await Promise.all([
    readSource('../src/styles.css'),
    readSource('../src/components/Sidebar.jsx')
  ]);

  assert.match(source, /\.sidebar\s+\.session-row\s*\{[\s\S]*grid-template-columns:\s*1fr[\s\S]*gap:\s*0/);
  assert.match(source, /\.sidebar\s+\.session-row\.active\s*\{[\s\S]*box-shadow:\s*inset\s+3px\s+0/);
  assert.match(source, /\.sidebar\s+\.session-row\.active::before/);
  assert.match(source, /\.session-history-copy\s+time/);
  assert.match(source, /\.sidebar\s+\.session-row\s+button\.icon-button\s*\{[\s\S]*position:\s*absolute/);
  assert.match(sidebar, /对话历史/);
  assert.match(sidebar, /visibleSessions = historyExpanded \? sessions : sessions\.slice\(0, 5\)/);
  assert.match(sidebar, /查看更多历史/);
});

test('asset suggestions are shown only while the search control is engaged', async () => {
  const source = await readSource('../src/App.jsx');

  assert.match(source, /const \[assetSearchOpen, setAssetSearchOpen\] = useState\(false\)/);
  assert.match(source, /onFocus=\{\(\) => setAssetSearchOpen\(true\)\}/);
  assert.match(source, /onBlur=\{\(\) => setAssetSearchOpen\(false\)\}/);
  assert.match(source, /assetSearchOpen && assetResults\.length > 0 && \(/);
  assert.match(source, /function selectAsset\(result\) \{[\s\S]*setAssetSearchOpen\(false\)/);
});

test('desktop research navigation is a compact horizontal control bar', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /@media \(min-width: 801px\)\s*\{[\s\S]*\.financial-research-workbench\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(source, /@media \(min-width: 801px\)\s*\{[\s\S]*\.financial-workbench-nav\s*\{[\s\S]*flex-direction:\s*row/);
});

test('desktop sidebar reserves a spacious history rail', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.app-shell\s*\{[\s\S]*grid-template-columns:\s*320px\s+minmax\(0,\s*1fr\)/);
});
